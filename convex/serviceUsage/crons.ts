/**
 * Usage tracking cron jobs — hourly rollup + 90-day retention.
 *
 * See Docs/usage-tracking/ADR.md §"Retention" and §"Read Path".
 */

import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const RETENTION_DAYS = 90;
const RETENTION_BATCH_SIZE = 100;

/** Align a timestamp down to the nearest hour boundary. */
function alignToHour(ts: number): number {
  return Math.floor(ts / HOUR_MS) * HOUR_MS;
}

// ──────────────────────────────────────────────────────────────────────────────
// Rollup — aggregate the PREVIOUS hour's events into one row per
// (serviceKey, feature) in `serviceUsageRollups`. Idempotent by
// (serviceKey, feature, bucketStart) — a re-run updates the row in place.
// ──────────────────────────────────────────────────────────────────────────────

export const rollup = internalMutation({
  args: {},
  returns: v.object({
    bucketStart: v.number(),
    groupsWritten: v.number(),
    eventsScanned: v.number(),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    const bucketStart = alignToHour(now - HOUR_MS);
    const bucketEnd = bucketStart + HOUR_MS;

    // Scan events in the bucket window. We iterate serviceKey by serviceKey
    // to leverage the index; since the registry holds a small fixed set we
    // just query by the composite index per known key.
    // Simplest correct approach: scan all events in the window via the
    // status index (broadest); bounded by 10k which is well above our
    // current hourly throughput.
    const eventsInBucket: Doc<"serviceUsageEvents">[] = [];
    const allStatuses: Doc<"serviceUsageEvents">["status"][] = [
      "success",
      "rate_limited",
      "quota_exceeded",
      "auth_error",
      "client_error",
      "server_error",
      "timeout",
      "unknown_error",
    ];
    for (const status of allStatuses) {
      const batch = await ctx.db
        .query("serviceUsageEvents")
        .withIndex("by_status_created", (q) =>
          q
            .eq("status", status)
            .gte("createdAt", bucketStart)
            .lt("createdAt", bucketEnd),
        )
        .take(5000);
      eventsInBucket.push(...batch);
    }

    // Group by (serviceKey, feature).
    type Agg = {
      serviceKey: string;
      feature: string;
      successCount: number;
      errorCount: number;
      totalDurationMs: number;
      totalInputTokens: number;
      totalOutputTokens: number;
      totalAudioSeconds: number;
      totalCostUsd: number;
    };
    const groups = new Map<string, Agg>();

    for (const e of eventsInBucket) {
      const key = `${e.serviceKey}::${e.feature}`;
      let agg = groups.get(key);
      if (!agg) {
        agg = {
          serviceKey: e.serviceKey,
          feature: e.feature,
          successCount: 0,
          errorCount: 0,
          totalDurationMs: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalAudioSeconds: 0,
          totalCostUsd: 0,
        };
        groups.set(key, agg);
      }
      if (e.status === "success") agg.successCount += 1;
      else agg.errorCount += 1;
      agg.totalDurationMs += e.durationMs ?? 0;
      agg.totalInputTokens += e.inputTokens ?? 0;
      agg.totalOutputTokens += e.outputTokens ?? 0;
      agg.totalAudioSeconds += e.audioSeconds ?? 0;
      agg.totalCostUsd += e.estimatedCostUsd ?? 0;
    }

    // Upsert each group.
    for (const agg of groups.values()) {
      const existing = await ctx.db
        .query("serviceUsageRollups")
        .withIndex("by_service_bucket", (q) =>
          q.eq("serviceKey", agg.serviceKey).eq("bucketStart", bucketStart),
        )
        .filter((q) => q.eq(q.field("feature"), agg.feature))
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          successCount: agg.successCount,
          errorCount: agg.errorCount,
          totalDurationMs: agg.totalDurationMs,
          totalInputTokens: agg.totalInputTokens,
          totalOutputTokens: agg.totalOutputTokens,
          totalAudioSeconds: agg.totalAudioSeconds,
          totalCostUsd: agg.totalCostUsd,
        });
      } else {
        await ctx.db.insert("serviceUsageRollups", {
          serviceKey: agg.serviceKey,
          feature: agg.feature,
          bucketStart,
          bucketSize: "1h",
          successCount: agg.successCount,
          errorCount: agg.errorCount,
          totalDurationMs: agg.totalDurationMs,
          totalInputTokens: agg.totalInputTokens,
          totalOutputTokens: agg.totalOutputTokens,
          totalAudioSeconds: agg.totalAudioSeconds,
          totalCostUsd: agg.totalCostUsd,
        });
      }
    }

    return {
      bucketStart,
      groupsWritten: groups.size,
      eventsScanned: eventsInBucket.length,
    };
  },
});

// ──────────────────────────────────────────────────────────────────────────────
// Retention — delete `serviceUsageEvents` older than 90 days in batches of
// 100. If more remain, reschedule ourselves to keep the mutation bounded.
// ──────────────────────────────────────────────────────────────────────────────

export const retention = internalMutation({
  args: {},
  returns: v.object({
    deleted: v.number(),
    countersDeleted: v.number(),
    rescheduled: v.boolean(),
  }),
  handler: async (ctx) => {
    const cutoff = Date.now() - RETENTION_DAYS * DAY_MS;

    // Grab the oldest events across all services via the status index.
    // We iterate one status at a time to leverage the (status, createdAt)
    // composite for a range scan, stopping as soon as we fill the batch.
    const allStatuses: Doc<"serviceUsageEvents">["status"][] = [
      "success",
      "rate_limited",
      "quota_exceeded",
      "auth_error",
      "client_error",
      "server_error",
      "timeout",
      "unknown_error",
    ];

    let deleted = 0;
    let hitBatchLimit = false;

    outer: for (const status of allStatuses) {
      const stale = await ctx.db
        .query("serviceUsageEvents")
        .withIndex("by_status_created", (q) =>
          q.eq("status", status).lt("createdAt", cutoff),
        )
        .take(RETENTION_BATCH_SIZE - deleted);
      for (const row of stale) {
        await ctx.db.delete(row._id);
        deleted += 1;
        if (deleted >= RETENTION_BATCH_SIZE) {
          hitBatchLimit = true;
          break outer;
        }
      }
    }

    // Also reap expired quota counters. One row per (service, quota,
    // bucket) — for minute-windowed quotas this can add up over time.
    // Use the `by_bucketStart` index to range-scan oldest-first.
    let countersDeleted = 0;
    if (!hitBatchLimit) {
      const staleCounters = await ctx.db
        .query("serviceQuotaCounters")
        .withIndex("by_bucketStart", (q) => q.lt("bucketStart", cutoff))
        .take(RETENTION_BATCH_SIZE - deleted);
      for (const row of staleCounters) {
        await ctx.db.delete(row._id);
        countersDeleted += 1;
        if (deleted + countersDeleted >= RETENTION_BATCH_SIZE) {
          hitBatchLimit = true;
          break;
        }
      }
    }

    // If we filled the batch, there may be more. Reschedule ourselves.
    let rescheduled = false;
    if (hitBatchLimit) {
      await ctx.scheduler.runAfter(
        0,
        internal.serviceUsage.crons.retention,
        {},
      );
      rescheduled = true;
    }

    return { deleted, countersDeleted, rescheduled };
  },
});
