/**
 * Service Usage Logger — the ONLY way to write `serviceUsageEvents` rows.
 *
 * Responsibilities (per Docs/usage-tracking/ADR.md §"Write Path"):
 *   1. Resolve the service definition from the registry.
 *   2. Compute `estimatedCostUsd` inline (denormalized, immutable once written).
 *   3. Insert one `serviceUsageEvents` row.
 *   4. Upsert the `serviceQuotaCounters` row for each configured quota and,
 *      if the new consumed % crossed a `notifyAtPct` threshold *within this
 *      bucket*, fire an admin notification.
 *
 * Caller shape: `logServiceUsage(ctx, { serviceKey, feature, status, ... })`.
 * This helper runs in mutation context. Actions cannot call `ctx.db` directly
 * — they invoke `internal.serviceUsage.logger.log` via `ctx.runMutation`.
 *
 * Cost note: the quota path is now O(1) per quota per log — a single
 * indexed `.unique()` read plus one insert-or-patch. The previous design
 * scanned up to 5000 events per log which dominated Convex function ops at
 * any non-trivial volume.
 */

import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  getServiceDefinition,
  quotaBucketStart,
  type ServiceKey,
  type ServiceQuota,
  type UsageMetrics,
} from "./serviceRegistry";
import { notifyAdmins } from "./adminNotifier";

type EventStatus = Doc<"serviceUsageEvents">["status"];

export interface LogServiceUsageInput {
  serviceKey: ServiceKey;
  feature: string;
  status: EventStatus;
  userId?: Id<"users">;
  durationMs?: number;
  requestBytes?: number;
  responseBytes?: number;
  inputTokens?: number;
  outputTokens?: number;
  audioSeconds?: number;
  errorCode?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
  /**
   * Escape hatch for callers that compute cost precisely at the call site
   * (e.g. the B2 storage snapshot cron, which multiplies total stored bytes
   * by the B2 per-GB-month price). If set, this overrides the registry's
   * `computeCost` output.
   */
  overrideCostUsd?: number;
}

export async function logServiceUsage(
  ctx: MutationCtx,
  input: LogServiceUsageInput,
): Promise<{ eventId: Id<"serviceUsageEvents"> }> {
  const now = Date.now();
  const definition = getServiceDefinition(input.serviceKey);

  const metrics: UsageMetrics = {
    durationMs: input.durationMs,
    requestBytes: input.requestBytes,
    responseBytes: input.responseBytes,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    audioSeconds: input.audioSeconds,
  };

  const estimatedCostUsd =
    input.overrideCostUsd !== undefined
      ? input.overrideCostUsd
      : definition?.computeCost
        ? definition.computeCost(metrics)
        : undefined;

  const eventId = await ctx.db.insert("serviceUsageEvents", {
    serviceKey: input.serviceKey,
    feature: input.feature,
    status: input.status,
    userId: input.userId,
    durationMs: input.durationMs,
    requestBytes: input.requestBytes,
    responseBytes: input.responseBytes,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    audioSeconds: input.audioSeconds,
    estimatedCostUsd,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
    metadata: input.metadata,
    createdAt: now,
  });

  // Quota threshold check. Failures here must NOT bubble — the primary write
  // already succeeded and losing a notification is cheaper than losing the
  // event log.
  if (definition?.quotas?.length) {
    try {
      await updateCountersAndNotify(
        ctx,
        input.serviceKey,
        input.feature,
        definition.quotas,
        metrics,
        estimatedCostUsd,
        now,
      );
    } catch {
      // swallow — logger is best-effort for notifications
    }
  }

  return { eventId };
}

/**
 * Convert this single event into a per-quota increment based on the
 * quota's metric. Returns 0 when the event doesn't contribute to this
 * particular quota (e.g. an event without input tokens against a token
 * quota).
 */
function incrementForQuota(
  quota: ServiceQuota,
  metrics: UsageMetrics,
  estimatedCostUsd: number | undefined,
): number {
  switch (quota.metric) {
    case "count":
      return 1;
    case "inputTokens":
      return metrics.inputTokens ?? 0;
    case "outputTokens":
      return metrics.outputTokens ?? 0;
    case "costUsd":
      return estimatedCostUsd ?? 0;
  }
}

async function updateCountersAndNotify(
  ctx: MutationCtx,
  serviceKey: ServiceKey,
  feature: string,
  quotas: ServiceQuota[],
  metrics: UsageMetrics,
  estimatedCostUsd: number | undefined,
  now: number,
) {
  for (const quota of quotas) {
    if (quota.limit <= 0) continue;

    // Feature-scoped quotas only increment when the current event's
    // feature matches. Service-wide quotas (quota.feature undefined)
    // increment on every event.
    if (quota.feature && quota.feature !== feature) continue;

    const increment = incrementForQuota(quota, metrics, estimatedCostUsd);
    if (increment <= 0) continue;

    const bucketStart = quotaBucketStart(quota.window, now);

    const existing = await ctx.db
      .query("serviceQuotaCounters")
      .withIndex("by_service_quota_bucket", (q) =>
        q
          .eq("serviceKey", serviceKey)
          .eq("quotaId", quota.id)
          .eq("bucketStart", bucketStart),
      )
      .unique();

    const prevConsumed = existing?.consumed ?? 0;
    const prevNotifiedPct = existing?.lastNotifiedPct ?? -1;
    const newConsumed = prevConsumed + increment;
    const prevPct = (prevConsumed / quota.limit) * 100;
    const newPct = (newConsumed / quota.limit) * 100;

    // Find the highest notifyAtPct we just crossed in this bucket: any
    // threshold whose value > prevPct AND <= newPct AND > prevNotifiedPct.
    // Walking thresholds descending and picking the first hit keeps noise
    // low — one notification per log even if we jumped past several
    // thresholds in a single tick.
    const crossed = [...quota.notifyAtPct]
      .sort((a, b) => b - a)
      .find(
        (threshold) =>
          threshold > prevNotifiedPct &&
          threshold > prevPct &&
          threshold <= newPct,
      );

    const nextNotifiedPct =
      crossed !== undefined ? Math.max(prevNotifiedPct, crossed) : prevNotifiedPct;

    if (existing) {
      await ctx.db.patch(existing._id, {
        consumed: newConsumed,
        lastNotifiedPct: nextNotifiedPct,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("serviceQuotaCounters", {
        serviceKey,
        quotaId: quota.id,
        bucketStart,
        consumed: newConsumed,
        lastNotifiedPct: nextNotifiedPct,
        updatedAt: now,
      });
    }

    if (crossed !== undefined) {
      const bucketKey = new Date(bucketStart).toISOString();
      const dedupeKey = `${quota.id}:${crossed}:${bucketKey}`;
      await notifyAdmins(ctx, {
        title: `${serviceKey} usage at ${crossed}%`,
        message: `${quota.label}: ${Math.round(newConsumed)} / ${quota.limit} (${newPct.toFixed(1)}%)`,
        data: {
          dedupeKey,
          serviceKey,
          quotaId: quota.id,
          threshold: crossed,
          consumed: newConsumed,
          limit: quota.limit,
        },
      });
    }
  }
}
