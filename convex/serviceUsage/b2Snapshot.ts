/**
 * Nightly B2 storage snapshot.
 *
 * Walks the `photos` table and sums `byteSize` for every row that has an
 * `objectKey` (i.e. is stored in B2 or MinIO — not Convex native storage).
 * Emits one `serviceUsageEvents` row per snapshot so the dashboard has a
 * time-series of total-stored-bytes and can show estimated monthly storage
 * cost on the Backblaze card.
 *
 * Cost model: B2 bills $0.006 per GB-month. We record both the point-in-time
 * byte total (metadata.totalBytes) and a monthly-cost estimate
 * (estimatedCostUsd) so the "This month" summary reflects storage spend
 * even though the underlying object counts don't change mid-month.
 *
 * Rows with missing `byteSize` are counted once in `metadata.photosWithoutSize`
 * so we can tell if coverage is complete.
 */

import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { logServiceUsage } from "../lib/serviceUsage";

const SCAN_LIMIT = 10_000; // photos table is small; fits in one page for now.
const B2_STORAGE_USD_PER_GB_MONTH = 0.006;

export const snapshot = internalMutation({
  args: {},
  returns: v.object({
    photoCount: v.number(),
    photosWithSize: v.number(),
    totalBytes: v.number(),
    totalGb: v.number(),
    estimatedMonthlyCostUsd: v.number(),
  }),
  handler: async (ctx) => {
    // We only want B2/MinIO-backed photos (skipped Convex native _storage).
    const rows = await ctx.db.query("photos").take(SCAN_LIMIT);

    let totalBytes = 0;
    let photosWithSize = 0;
    let photoCount = 0;

    for (const row of rows as Doc<"photos">[]) {
      if (!row.objectKey) continue; // skip Convex _storage photos
      photoCount += 1;
      if (typeof row.byteSize === "number" && row.byteSize > 0) {
        totalBytes += row.byteSize;
        photosWithSize += 1;
      }
    }

    const totalGb = totalBytes / 1_000_000_000;
    const estimatedMonthlyCostUsd = totalGb * B2_STORAGE_USD_PER_GB_MONTH;

    await logServiceUsage(ctx, {
      serviceKey: "b2",
      feature: "b2_storage_snapshot",
      status: "success",
      // `requestBytes` holds the currently-stored byte total so rollups can
      // surface it on the dashboard without parsing metadata.
      requestBytes: totalBytes,
      // The dashboard reads `estimatedCostUsd` directly; supply the real
      // storage cost here so "This month" reflects storage spend.
      overrideCostUsd: estimatedMonthlyCostUsd,
      metadata: {
        photoCount,
        photosWithSize,
        photosWithoutSize: photoCount - photosWithSize,
        totalGb,
        estimatedMonthlyCostUsd,
      },
    });

    return {
      photoCount,
      photosWithSize,
      totalBytes,
      totalGb,
      estimatedMonthlyCostUsd,
    };
  },
});
