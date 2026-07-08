"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  copyObjectBetweenStores,
  requireB2Config,
  requireMinioConfig,
} from "../lib/externalStorage";

const DAY_MS = 24 * 60 * 60 * 1000;

export const archiveSevenDayPhotos = internalAction({
  args: {
    olderThanDays: v.optional(v.number()),
    batchSize: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const olderThanDays = Math.max(1, Math.floor(args.olderThanDays ?? 7));
    const batchSize = Math.max(1, Math.min(200, Math.floor(args.batchSize ?? 50)));
    const dryRun = args.dryRun === true;
    const cutoffTs = Date.now() - olderThanDays * DAY_MS;

    const sourceConfig = requireB2Config();
    const archiveConfig = requireMinioConfig();

    const candidates: Array<{
      photoId: Id<"photos">;
      uploadedAt: number;
      sourceProvider: string;
      sourceBucket: string;
      sourceObjectKey: string;
    }> = await ctx.runQuery(internal.files.archiveState.listArchiveCandidates, {
      beforeTs: cutoffTs,
      limit: batchSize,
    });

    let processed = 0;
    let archived = 0;
    let failed = 0;

    for (const candidate of candidates) {
      processed += 1;
      const archiveObjectKey = buildArchiveObjectKey({
        photoId: candidate.photoId,
        uploadedAt: candidate.uploadedAt,
        sourceObjectKey: candidate.sourceObjectKey,
      });

      const copyStartedAt = Date.now();
      try {
        if (!dryRun) {
          await copyObjectBetweenStores({
            sourceConfig,
            sourceBucket: candidate.sourceBucket,
            sourceObjectKey: candidate.sourceObjectKey,
            destinationConfig: archiveConfig,
            destinationBucket: archiveConfig.bucket,
            destinationObjectKey: archiveObjectKey,
          });

          await ctx.runMutation(internal.files.archiveState.markArchiveSuccess, {
            photoId: candidate.photoId,
            sourceProvider: candidate.sourceProvider,
            sourceBucket: candidate.sourceBucket,
            sourceObjectKey: candidate.sourceObjectKey,
            archiveProvider: archiveConfig.provider,
            archiveBucket: archiveConfig.bucket,
            archiveObjectKey,
            archivedAt: Date.now(),
          });
        }

        // Log the copy as a B2 op (read from B2 hot + write to archive).
        // The archive bucket may be MinIO, but the read leg hits B2 so we
        // attribute it there for quota visibility.
        try {
          await ctx.runMutation(internal.serviceUsage.logger.log, {
            serviceKey: "b2",
            feature: "b2_archive_copy",
            status: dryRun ? "success" : "success",
            durationMs: Date.now() - copyStartedAt,
            metadata: {
              sourceBucket: candidate.sourceBucket,
              archiveBucket: archiveConfig.bucket,
              archiveProvider: archiveConfig.provider,
              photoId: candidate.photoId,
              dryRun,
            },
          });
        } catch {
          // best-effort
        }

        archived += 1;
      } catch (error) {
        failed += 1;
        await ctx.runMutation(internal.files.archiveState.markArchiveFailure, {
          photoId: candidate.photoId,
          sourceProvider: candidate.sourceProvider,
          sourceBucket: candidate.sourceBucket,
          sourceObjectKey: candidate.sourceObjectKey,
          archiveProvider: archiveConfig.provider,
          archiveBucket: archiveConfig.bucket,
          archiveObjectKey,
          error: stringifyError(error),
          failedAt: Date.now(),
        });
        try {
          await ctx.runMutation(internal.serviceUsage.logger.log, {
            serviceKey: "b2",
            feature: "b2_archive_copy",
            status: "unknown_error",
            durationMs: Date.now() - copyStartedAt,
            errorMessage: stringifyError(error).slice(0, 500),
            metadata: {
              sourceBucket: candidate.sourceBucket,
              archiveBucket: archiveConfig.bucket,
              archiveProvider: archiveConfig.provider,
              photoId: candidate.photoId,
            },
          });
        } catch {
          // best-effort
        }
      }
    }

    return {
      ok: true,
      dryRun,
      cutoffTs,
      olderThanDays,
      processed,
      archived,
      failed,
    };
  },
});

function buildArchiveObjectKey(args: {
  photoId: Id<"photos">;
  uploadedAt: number;
  sourceObjectKey: string;
}): string {
  const sourceName = args.sourceObjectKey.split("/").at(-1) ?? "photo.bin";
  const datePart = new Date(args.uploadedAt).toISOString().slice(0, 10);
  return `photo-archive/${datePart}/${args.photoId}-${sourceName}`;
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown archive error";
  }
}
