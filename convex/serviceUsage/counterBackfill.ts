/**
 * One-shot counter backfill — rebuilds `serviceQuotaCounters` rows for the
 * CURRENT quota bucket from `serviceUsageEvents`.
 *
 * Needed because PR #15 introduced the counter table but didn't include a
 * migration: log events that fired before #15 deployed live in
 * `serviceUsageEvents` but didn't populate counters, so today's quota
 * progress bars read 0 even for services that already had traffic.
 *
 * Run once via `npx convex run serviceUsage/counterBackfill:run` or call
 * the admin-triggered `trigger` mutation. Re-running is safe — the logic
 * is idempotent (it overwrites the counter with the computed total).
 *
 * Scope: rebuilds ONLY the current bucket for each configured quota.
 * Past-bucket rebuilds aren't useful since notifications only fire for
 * the live bucket.
 */

import { v } from "convex/values";
import { internalMutation, mutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { requireAdmin } from "../lib/auth";
import {
  SERVICE_DEFINITIONS,
  quotaBucketStart,
  type ServiceKey,
  type ServiceQuota,
} from "../lib/serviceRegistry";
import type { Doc } from "../_generated/dataModel";

const EVENT_SCAN_CAP = 50_000;

type EventServiceKey = Doc<"serviceUsageEvents">["serviceKey"];

function sumForQuota(
  events: Doc<"serviceUsageEvents">[],
  quota: ServiceQuota,
): number {
  const scoped = quota.feature
    ? events.filter((e) => e.feature === quota.feature)
    : events;
  let total = 0;
  for (const e of scoped) {
    switch (quota.metric) {
      case "count":
        total += 1;
        break;
      case "inputTokens":
        total += e.inputTokens ?? 0;
        break;
      case "outputTokens":
        total += e.outputTokens ?? 0;
        break;
      case "costUsd":
        total += e.estimatedCostUsd ?? 0;
        break;
    }
  }
  return total;
}

/**
 * Internal worker — iterates every service in the registry, rebuilds the
 * current bucket's counter for each of that service's quotas.
 */
export const run = internalMutation({
  args: {},
  returns: v.object({
    countersUpserted: v.number(),
    perQuota: v.array(
      v.object({
        serviceKey: v.string(),
        quotaId: v.string(),
        bucketStart: v.number(),
        consumed: v.number(),
      }),
    ),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    const perQuota: Array<{
      serviceKey: string;
      quotaId: string;
      bucketStart: number;
      consumed: number;
    }> = [];

    const keys = Object.keys(SERVICE_DEFINITIONS) as ServiceKey[];
    for (const key of keys) {
      const def = SERVICE_DEFINITIONS[key];
      if (!def.quotas?.length) continue;

      // One scan per service, then slice in memory per quota — cheaper
      // than N scans when a service has multiple quotas over overlapping
      // windows.
      const maxWindowMs = Math.max(
        ...def.quotas.map((q) => {
          switch (q.window) {
            case "minute":
              return 60 * 1000;
            case "hour":
              return 60 * 60 * 1000;
            case "day":
              return 24 * 60 * 60 * 1000;
            case "month":
              return 30 * 24 * 60 * 60 * 1000;
          }
        }),
      );
      const windowStart = now - maxWindowMs;
      const allEvents = await ctx.db
        .query("serviceUsageEvents")
        .withIndex("by_service_created", (q) =>
          q
            .eq("serviceKey", key as EventServiceKey)
            .gte("createdAt", windowStart),
        )
        .take(EVENT_SCAN_CAP);

      for (const quota of def.quotas) {
        const bucketStart = quotaBucketStart(quota.window, now);
        const bucketEvents = allEvents.filter(
          (e) => e.createdAt >= bucketStart,
        );
        const consumed = sumForQuota(bucketEvents, quota);

        const existing = await ctx.db
          .query("serviceQuotaCounters")
          .withIndex("by_service_quota_bucket", (q) =>
            q
              .eq("serviceKey", key)
              .eq("quotaId", quota.id)
              .eq("bucketStart", bucketStart),
          )
          .unique();

        if (existing) {
          await ctx.db.patch(existing._id, {
            consumed,
            updatedAt: now,
            // Preserve lastNotifiedPct so re-running doesn't replay alerts.
          });
        } else {
          await ctx.db.insert("serviceQuotaCounters", {
            serviceKey: key,
            quotaId: quota.id,
            bucketStart,
            consumed,
            // Infer from reconstructed consumption: if we're already past
            // a threshold, mark it notified so we don't alert retroactively.
            lastNotifiedPct: (() => {
              const pct = (consumed / quota.limit) * 100;
              const already = [...quota.notifyAtPct]
                .sort((a, b) => b - a)
                .find((t) => pct >= t);
              return already ?? -1;
            })(),
            updatedAt: now,
          });
        }

        perQuota.push({
          serviceKey: key,
          quotaId: quota.id,
          bucketStart,
          consumed,
        });
      }
    }

    return {
      countersUpserted: perQuota.length,
      perQuota,
    };
  },
});

/**
 * Admin-triggered version — same logic, safe to call from the dashboard
 * or the Convex CLI. Scheduled so the caller doesn't wait on a potentially
 * long scan.
 */
export const trigger = mutation({
  args: {},
  returns: v.object({ scheduledId: v.string() }),
  handler: async (ctx): Promise<{ scheduledId: string }> => {
    await requireAdmin(ctx);
    const scheduledId = await ctx.scheduler.runAfter(
      0,
      internal.serviceUsage.counterBackfill.run,
      {},
    );
    return { scheduledId: scheduledId as unknown as string };
  },
});
