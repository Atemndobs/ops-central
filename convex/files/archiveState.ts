import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";

const ARCHIVED_TIER = "archive_minio";
/** Tier stamped on upload (see files/mutations.ts) — i.e. "not archived yet". */
const HOT_TIER = "hot";

export const listArchiveCandidates = internalQuery({
  args: {
    beforeTs: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(200, Math.floor(args.limit)));

    // STARVATION FIX. This previously walked `by_uploaded_at` — which is ASCENDING
    // — with `.take(limit * 4)` and then dropped already-archived rows in memory:
    //
    //     .withIndex("by_uploaded_at", (q) => q.lte("uploadedAt", beforeTs))
    //     .take(limit * 4)
    //     .filter((row) => row.archivedTier !== ARCHIVED_TIER)
    //
    // So it always re-read the SAME oldest N photos. Once those were archived the
    // in-memory filter dropped every one of them, the query returned [], and the
    // cron made no further progress — permanently — while still paying ~400 reads
    // per run. Archiving to MinIO was silently dead.
    //
    // Read only rows that are actually still candidates, via
    // `by_archived_tier_and_uploaded`. Note there are TWO un-archived states, not
    // one: rows uploaded since the tier field was introduced carry "hot"
    // (files/mutations.ts), while older rows predate it and have no tier at all.
    // The old `!== ARCHIVED_TIER` filter matched both, so both must be read here —
    // indexing on `undefined` alone would have kept archiving dead.
    const [hotRows, legacyRows] = await Promise.all([
      ctx.db
        .query("photos")
        .withIndex("by_archived_tier_and_uploaded", (q) =>
          q.eq("archivedTier", HOT_TIER).lte("uploadedAt", args.beforeTs),
        )
        .take(limit * 4),
      ctx.db
        .query("photos")
        .withIndex("by_archived_tier_and_uploaded", (q) =>
          q.eq("archivedTier", undefined).lte("uploadedAt", args.beforeTs),
        )
        .take(limit * 4),
    ]);

    // Oldest first — same order the ascending `by_uploaded_at` walk produced.
    const rows = [...hotRows, ...legacyRows].sort(
      (a, b) => a.uploadedAt - b.uploadedAt,
    );

    return rows
      .filter((row) => row.provider === "b2")
      .filter((row) => Boolean(row.bucket && row.objectKey))
      .slice(0, limit)
      .map((row) => ({
        photoId: row._id,
        uploadedAt: row.uploadedAt,
        sourceProvider: row.provider ?? "b2",
        sourceBucket: row.bucket!,
        sourceObjectKey: row.objectKey!,
      }));
  },
});

export const markArchiveSuccess = internalMutation({
  args: {
    photoId: v.id("photos"),
    sourceProvider: v.string(),
    sourceBucket: v.string(),
    sourceObjectKey: v.string(),
    archiveProvider: v.string(),
    archiveBucket: v.string(),
    archiveObjectKey: v.string(),
    archivedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const photo = await ctx.db.get(args.photoId);
    if (!photo) {
      return false;
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("photoArchives")
      .withIndex("by_photo", (q) => q.eq("photoId", args.photoId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        sourceProvider: args.sourceProvider,
        sourceBucket: args.sourceBucket,
        sourceObjectKey: args.sourceObjectKey,
        archiveProvider: args.archiveProvider,
        archiveBucket: args.archiveBucket,
        archiveObjectKey: args.archiveObjectKey,
        status: "archived",
        attempts: existing.attempts + 1,
        lastAttemptAt: now,
        archivedAt: args.archivedAt,
        failedAt: undefined,
        lastError: undefined,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("photoArchives", {
        photoId: args.photoId,
        sourceProvider: args.sourceProvider,
        sourceBucket: args.sourceBucket,
        sourceObjectKey: args.sourceObjectKey,
        archiveProvider: args.archiveProvider,
        archiveBucket: args.archiveBucket,
        archiveObjectKey: args.archiveObjectKey,
        status: "archived",
        attempts: 1,
        lastAttemptAt: now,
        archivedAt: args.archivedAt,
        createdAt: now,
        updatedAt: now,
      });
    }

    await ctx.db.patch(args.photoId, {
      archivedTier: ARCHIVED_TIER,
      archivedAt: args.archivedAt,
    });

    return true;
  },
});

export const markArchiveFailure = internalMutation({
  args: {
    photoId: v.id("photos"),
    sourceProvider: v.string(),
    sourceBucket: v.string(),
    sourceObjectKey: v.string(),
    archiveProvider: v.string(),
    archiveBucket: v.string(),
    archiveObjectKey: v.string(),
    error: v.string(),
    failedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("photoArchives")
      .withIndex("by_photo", (q) => q.eq("photoId", args.photoId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        sourceProvider: args.sourceProvider,
        sourceBucket: args.sourceBucket,
        sourceObjectKey: args.sourceObjectKey,
        archiveProvider: args.archiveProvider,
        archiveBucket: args.archiveBucket,
        archiveObjectKey: args.archiveObjectKey,
        status: "failed",
        attempts: existing.attempts + 1,
        lastAttemptAt: now,
        failedAt: args.failedAt,
        lastError: args.error.slice(0, 2000),
        updatedAt: now,
      });
      return existing._id;
    }

    return ctx.db.insert("photoArchives", {
      photoId: args.photoId,
      sourceProvider: args.sourceProvider,
      sourceBucket: args.sourceBucket,
      sourceObjectKey: args.sourceObjectKey,
      archiveProvider: args.archiveProvider,
      archiveBucket: args.archiveBucket,
      archiveObjectKey: args.archiveObjectKey,
      status: "failed",
      attempts: 1,
      lastAttemptAt: now,
      failedAt: args.failedAt,
      lastError: args.error.slice(0, 2000),
      createdAt: now,
      updatedAt: now,
    });
  },
});
