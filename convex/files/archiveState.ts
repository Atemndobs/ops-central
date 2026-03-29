import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";

const ARCHIVED_TIER = "archive_minio";

export const listArchiveCandidates = internalQuery({
  args: {
    beforeTs: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(200, Math.floor(args.limit)));
    const rows = await ctx.db
      .query("photos")
      .withIndex("by_uploaded_at", (q) => q.lte("uploadedAt", args.beforeTs))
      .take(limit * 4);

    return rows
      .filter((row) => row.provider === "b2")
      .filter((row) => Boolean(row.bucket && row.objectKey))
      .filter((row) => row.archivedTier !== ARCHIVED_TIER)
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
