/**
 * Service Usage Logger — the ONLY way to write `serviceUsageEvents` rows.
 *
 * Responsibilities (per Docs/usage-tracking/ADR.md §"Write Path"):
 *   1. Resolve the service definition from the registry.
 *   2. Compute `estimatedCostUsd` inline (denormalized, immutable once written).
 *   3. Insert one `serviceUsageEvents` row.
 *   4. Check each quota for the service: count events in the relevant window
 *      (bounded with `.take()`), compute consumption %, and if we just crossed
 *      a `notifyAtPct` threshold, fire a debounced admin notification.
 *
 * Caller shape: `logServiceUsage(ctx, { serviceKey, feature, status, ... })`.
 * This helper runs in mutation context. Actions cannot call `ctx.db` directly
 * — they invoke `internal.serviceUsage.logger.log` via `ctx.runMutation`.
 */

import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  SERVICE_DEFINITIONS,
  getServiceDefinition,
  quotaWindowMs,
  type ServiceKey,
  type UsageMetrics,
} from "./serviceRegistry";
import { notifyAdmins } from "./adminNotifier";

// Keep quota counting bounded — we never need an exact count, only a
// threshold comparison. 5000 is well above any free-tier per-day cap.
const MAX_QUOTA_SCAN = 5000;

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
      await checkQuotasAndNotify(ctx, input.serviceKey, definition.quotas, now);
    } catch {
      // swallow — logger is best-effort for notifications
    }
  }

  return { eventId };
}

async function checkQuotasAndNotify(
  ctx: MutationCtx,
  serviceKey: ServiceKey,
  quotas: NonNullable<
    (typeof SERVICE_DEFINITIONS)[ServiceKey]["quotas"]
  >,
  now: number,
) {
  const dayBucket = new Date(now).toISOString().slice(0, 10); // YYYY-MM-DD UTC

  for (const quota of quotas) {
    const windowStart = now - quotaWindowMs(quota.window);

    // Pull a bounded window of events for this service. We filter in memory
    // by feature and by metric so we can support metric=count/tokens/cost in
    // one pass.
    const events = await ctx.db
      .query("serviceUsageEvents")
      .withIndex("by_service_created", (q) =>
        q.eq("serviceKey", serviceKey).gte("createdAt", windowStart),
      )
      .take(MAX_QUOTA_SCAN);

    const scoped = quota.feature
      ? events.filter((e) => e.feature === quota.feature)
      : events;

    let consumed = 0;
    for (const e of scoped) {
      switch (quota.metric) {
        case "count":
          consumed += 1;
          break;
        case "inputTokens":
          consumed += e.inputTokens ?? 0;
          break;
        case "outputTokens":
          consumed += e.outputTokens ?? 0;
          break;
        case "costUsd":
          consumed += e.estimatedCostUsd ?? 0;
          break;
      }
    }

    if (quota.limit <= 0) continue;
    const pct = (consumed / quota.limit) * 100;

    // Fire for the HIGHEST threshold crossed, not every one below. The
    // adminNotifier's 1-hour dedupe plus the per-day bucket key prevent
    // spamming if we keep crossing the same threshold within the window.
    const crossed = [...quota.notifyAtPct]
      .sort((a, b) => b - a)
      .find((t) => pct >= t);
    if (crossed === undefined) continue;

    const dedupeKey = `${quota.id}:${crossed}:${dayBucket}`;
    await notifyAdmins(ctx, {
      title: `${serviceKey} usage at ${crossed}%`,
      message: `${quota.label}: ${Math.round(consumed)} / ${quota.limit} (${pct.toFixed(1)}%)`,
      data: {
        dedupeKey,
        serviceKey,
        quotaId: quota.id,
        threshold: crossed,
        consumed,
        limit: quota.limit,
      },
    });
  }
}
