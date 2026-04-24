/**
 * Nightly B2 storage snapshot.
 *
 * Reads the running aggregate from `photoStorageAggregate` (maintained
 * incrementally on every photo insert/delete — see
 * `convex/lib/photoStorageAggregate.ts`) and emits one `serviceUsageEvents`
 * row per snapshot so the dashboard has a time-series of total-stored-bytes
 * and can show estimated monthly storage cost on the Backblaze card.
 *
 * Previously this mutation scanned up to 10k rows of the photos table each
 * night. The aggregate lookup is now a single-row read regardless of photo
 * volume.
 *
 * If the aggregate row is missing (e.g. immediately after deploy, before
 * `backfillPhotoStorageAggregate` has run), fall back to a one-time scan
 * so the dashboard still reports sane numbers.
 *
 * Cost model: B2 bills $0.006 per GB-month. We record both the point-in-time
 * byte total (metadata.totalBytes) and a monthly-cost estimate
 * (estimatedCostUsd) so the "This month" summary reflects storage spend
 * even though the underlying object counts don't change mid-month.
 */

import { v } from "convex/values";
import {
  internalMutation,
  mutation,
  type MutationCtx,
} from "../_generated/server";
import { internal } from "../_generated/api";
import { logServiceUsage } from "../lib/serviceUsage";
import { requireAdmin } from "../lib/auth";

const FALLBACK_SCAN_LIMIT = 10_000;
const B2_STORAGE_USD_PER_GB_MONTH = 0.006;

type SnapshotTotals = {
  photoCount: number;
  photosWithSize: number;
  totalBytes: number;
  source: "aggregate" | "fallback_scan";
};

export const snapshot = internalMutation({
  args: {},
  returns: v.object({
    photoCount: v.number(),
    photosWithSize: v.number(),
    totalBytes: v.number(),
    totalGb: v.number(),
    estimatedMonthlyCostUsd: v.number(),
    source: v.union(v.literal("aggregate"), v.literal("fallback_scan")),
  }),
  handler: async (ctx) => {
    const aggregate = await ctx.db.query("photoStorageAggregate").first();

    const totals: SnapshotTotals = aggregate
      ? {
          photoCount: aggregate.photoCount,
          photosWithSize: aggregate.photosWithSize,
          totalBytes: aggregate.totalBytes,
          source: "aggregate",
        }
      : await computeFromScan(ctx);

    const totalGb = totals.totalBytes / 1_000_000_000;
    const estimatedMonthlyCostUsd = totalGb * B2_STORAGE_USD_PER_GB_MONTH;

    await logServiceUsage(ctx, {
      serviceKey: "b2",
      feature: "b2_storage_snapshot",
      status: "success",
      requestBytes: totals.totalBytes,
      overrideCostUsd: estimatedMonthlyCostUsd,
      metadata: {
        photoCount: totals.photoCount,
        photosWithSize: totals.photosWithSize,
        photosWithoutSize: totals.photoCount - totals.photosWithSize,
        totalGb,
        estimatedMonthlyCostUsd,
        source: totals.source,
      },
    });

    return {
      photoCount: totals.photoCount,
      photosWithSize: totals.photosWithSize,
      totalBytes: totals.totalBytes,
      totalGb,
      estimatedMonthlyCostUsd,
      source: totals.source,
    };
  },
});

async function computeFromScan(ctx: MutationCtx): Promise<SnapshotTotals> {
  const rows = await ctx.db.query("photos").take(FALLBACK_SCAN_LIMIT);
  let totalBytes = 0;
  let photosWithSize = 0;
  let photoCount = 0;
  for (const row of rows) {
    if (!row.objectKey) continue;
    photoCount += 1;
    if (typeof row.byteSize === "number" && row.byteSize > 0) {
      totalBytes += row.byteSize;
      photosWithSize += 1;
    }
  }
  return { photoCount, photosWithSize, totalBytes, source: "fallback_scan" };
}

/**
 * One-shot backfill to seed `photoStorageAggregate` from the current photos
 * table. Idempotent — re-running SETS the aggregate to the scanned total,
 * so it also serves as a reconciliation tool if the running aggregate ever
 * drifts from ground truth.
 *
 * Run once after deploying via the Convex dashboard:
 *   Functions → serviceUsage/b2Snapshot:backfillPhotoStorageAggregate
 *
 * Tracked in: Docs/2026-04-24-cron-jobs-architecture-and-cost-reduction.md
 */
export const backfillPhotoStorageAggregate = internalMutation({
  args: {},
  returns: v.object({
    totalBytes: v.number(),
    photoCount: v.number(),
    photosWithSize: v.number(),
  }),
  handler: async (ctx) => {
    const rows = await ctx.db.query("photos").take(FALLBACK_SCAN_LIMIT);
    let totalBytes = 0;
    let photoCount = 0;
    let photosWithSize = 0;
    for (const row of rows) {
      if (!row.objectKey) continue;
      photoCount += 1;
      if (typeof row.byteSize === "number" && row.byteSize > 0) {
        totalBytes += row.byteSize;
        photosWithSize += 1;
      }
    }

    const existing = await ctx.db.query("photoStorageAggregate").first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        totalBytes,
        photoCount,
        photosWithSize,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("photoStorageAggregate", {
        totalBytes,
        photoCount,
        photosWithSize,
        updatedAt: now,
      });
    }

    return { totalBytes, photoCount, photosWithSize };
  },
});

/**
 * Admin-triggered on-demand refresh. Schedules the snapshot to run
 * immediately (runAfter 0) so the admin doesn't have to wait for the
 * daily 01:00 UTC cron. Returns quickly — the dashboard query will pick
 * up the fresh row on its next reactive tick.
 */
export const refresh = mutation({
  args: {},
  returns: v.object({
    scheduledId: v.string(),
    scheduledAt: v.number(),
  }),
  handler: async (ctx): Promise<{ scheduledId: string; scheduledAt: number }> => {
    await requireAdmin(ctx);
    const scheduledAt = Date.now();
    const scheduledId = await ctx.scheduler.runAfter(
      0,
      internal.serviceUsage.b2Snapshot.snapshot,
      {},
    );
    return { scheduledId: scheduledId as unknown as string, scheduledAt };
  },
});
