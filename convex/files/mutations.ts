import { mutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser } from "../lib/auth";
import {
  createExternalReadUrl,
  createExternalUploadUrl,
  deleteExternalObject,
  requireExternalStorageConfig,
} from "../lib/externalStorage";
import { normalizeRoomName } from "../lib/rooms";
import { logServiceUsage } from "../lib/serviceUsage";
import {
  onPhotoDeleted,
  onPhotoInserted,
} from "../lib/photoStorageAggregate";
import {
  ALLOWED_POSTER_MIMES,
  assertCanonicalPoster,
  assertCanonicalVideo,
  ERROR_CODES,
  isVideoMime,
} from "../lib/mediaValidation";
import type { Id } from "../_generated/dataModel";

/**
 * Fire-and-forget B2 op logger. Runs in the current mutation transaction —
 * if the outer mutation rolls back, the log rolls back too (desirable: we
 * only record events for ops that committed). Never throws.
 */
async function logB2Op(
  ctx: MutationCtx,
  input: {
    feature: string;
    status: Parameters<typeof logServiceUsage>[1]["status"];
    durationMs: number;
    userId?: Id<"users">;
    requestBytes?: number;
    errorCode?: string;
    errorMessage?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await logServiceUsage(ctx, {
      serviceKey: "b2",
      feature: input.feature,
      status: input.status,
      durationMs: input.durationMs,
      userId: input.userId,
      requestBytes: input.requestBytes,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      metadata: input.metadata,
    });
  } catch {
    // best-effort
  }
}

const photoTypeValidator = v.union(
  v.literal("before"),
  v.literal("after"),
  v.literal("incident"),
);

const photoSourceValidator = v.union(
  v.literal("app"),
  v.literal("whatsapp"),
  v.literal("manual"),
);

/**
 * Discriminator for the external upload path. `"image"` keeps the legacy
 * single-ticket behaviour; `"video"` issues a dual ticket (video + poster)
 * per ADR-0004 and rejects when external storage is not configured.
 *
 * `undefined` from a legacy client is treated as `"image"` for backward
 * compatibility.
 */
const mediaKindValidator = v.union(v.literal("image"), v.literal("video"));

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await getCurrentUser(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const uploadJobPhoto = mutation({
  args: {
    storageId: v.id("_storage"),
    jobId: v.id("cleaningJobs"),
    roomName: v.string(),
    photoType: photoTypeValidator,
    source: photoSourceValidator,
    notes: v.optional(v.string()),
    /**
     * Optional. When provided, the legacy Convex-storage path REJECTS any
     * `video/*` MIME with `VIDEO_REQUIRES_EXTERNAL_UPLOAD` per ADR-0002.
     * Existing image callers don't need to pass this; they keep working.
     */
    contentType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    if (isVideoMime(args.contentType)) {
      throw new Error(
        `[${ERROR_CODES.VIDEO_REQUIRES_EXTERNAL_UPLOAD}] ` +
          `Video uploads must use the external upload path ` +
          `(getExternalUploadUrl with mediaKind: "video"). See ADR-0002.`,
      );
    }

    const job = await ctx.db.get(args.jobId);
    if (!job) {
      throw new Error("Cleaning job not found");
    }

    const property = await ctx.db.get(job.propertyId);
    const roomName = normalizeRoomName(property, args.roomName);

    return await ctx.db.insert("photos", {
      cleaningJobId: args.jobId,
      storageId: args.storageId,
      roomName,
      type: args.photoType,
      source: args.source,
      notes: args.notes,
      uploadedBy: user._id,
      uploadedAt: Date.now(),
      // Legacy path is image-only by construction. Set the discriminator
      // explicitly so future readers don't guess.
      mediaKind: "image",
    });
  },
});

export const getExternalUploadUrl = mutation({
  args: {
    jobId: v.id("cleaningJobs"),
    roomName: v.string(),
    photoType: photoTypeValidator,
    source: photoSourceValidator,
    notes: v.optional(v.string()),
    contentType: v.string(),
    fileName: v.optional(v.string()),
    byteSize: v.optional(v.number()),
    /**
     * Optional. Defaults to `"image"` (legacy behaviour: one upload URL).
     * When `"video"`, issues a dual ticket: one PUT URL for the video
     * object + one PUT URL for the poster JPEG. Per ADR-0002, video
     * requires external storage to be healthy; otherwise we throw
     * `EXTERNAL_STORAGE_REQUIRED_FOR_VIDEO`.
     */
    mediaKind: v.optional(mediaKindValidator),
    /** Required when `mediaKind === "video"` — MIME of the poster blob.
     *  Must be in ALLOWED_POSTER_MIMES (image/jpeg). */
    posterContentType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      throw new Error("Cleaning job not found");
    }

    const config = requireExternalStorageConfig();
    const mediaKind = args.mediaKind ?? "image";

    if (mediaKind === "video") {
      // Pre-flight checks specific to video.
      if (!args.posterContentType) {
        throw new Error(
          `[${ERROR_CODES.VIDEO_REQUIRES_POSTER}] ` +
            `Video uploads must include a posterContentType for the dual ticket.`,
        );
      }
      if (!ALLOWED_POSTER_MIMES.includes(args.posterContentType)) {
        throw new Error(
          `[${ERROR_CODES.POSTER_MIME_NOT_ALLOWED}] ` +
            `Poster MIME "${args.posterContentType}" is not allowed.`,
        );
      }
    }

    const startedAt = Date.now();

    if (mediaKind === "image") {
      // ─── Legacy single-ticket path (unchanged behaviour) ──────────────
      const objectKey = buildPhotoObjectKey({
        jobId: args.jobId,
        photoType: args.photoType,
        fileName: args.fileName,
      });

      const { url, expiresAt } = await createExternalUploadUrl({
        bucket: config.bucket,
        objectKey,
        contentType: args.contentType,
      });

      await trackPendingUpload(ctx, {
        cleaningJobId: args.jobId,
        mediaKind: "image",
        provider: config.provider,
        bucket: config.bucket,
        objectKey,
        expiresAt,
      });

      await logB2Op(ctx, {
        feature: "b2_upload_url",
        status: "success",
        durationMs: Date.now() - startedAt,
        userId: user._id,
        requestBytes: args.byteSize,
        metadata: {
          bucket: config.bucket,
          provider: config.provider,
          jobId: args.jobId,
          photoType: args.photoType,
          mediaKind: "image",
        },
      });

      return {
        mediaKind: "image" as const,
        url,
        method: "PUT" as const,
        headers: { "Content-Type": args.contentType },
        objectKey,
        bucket: config.bucket,
        provider: config.provider,
        expiresAt,
      };
    }

    // ─── Video dual-ticket path (Phase 1) ────────────────────────────────
    const videoObjectKey = buildVideoObjectKey({
      jobId: args.jobId,
      fileName: args.fileName,
    });
    const posterObjectKey = `${videoObjectKey}.poster.jpg`;

    const [videoTicket, posterTicket] = await Promise.all([
      createExternalUploadUrl({
        bucket: config.bucket,
        objectKey: videoObjectKey,
        contentType: args.contentType,
      }),
      createExternalUploadUrl({
        bucket: config.bucket,
        objectKey: posterObjectKey,
        contentType: args.posterContentType!,
      }),
    ]);

    // Use the earlier expiry as the conservative single value the client
    // sees; both tickets are typically issued with the same TTL.
    const expiresAt = Math.min(videoTicket.expiresAt, posterTicket.expiresAt);

    await trackPendingUpload(ctx, {
      cleaningJobId: args.jobId,
      mediaKind: "video",
      provider: config.provider,
      bucket: config.bucket,
      objectKey: videoObjectKey,
      posterObjectKey,
      expiresAt,
    });

    await logB2Op(ctx, {
      feature: "b2_upload_url",
      status: "success",
      durationMs: Date.now() - startedAt,
      userId: user._id,
      requestBytes: args.byteSize,
      metadata: {
        bucket: config.bucket,
        provider: config.provider,
        jobId: args.jobId,
        photoType: args.photoType,
        mediaKind: "video",
      },
    });

    return {
      mediaKind: "video" as const,
      videoUploadUrl: videoTicket.url,
      videoObjectKey,
      videoMethod: "PUT" as const,
      videoHeaders: { "Content-Type": args.contentType },
      posterUploadUrl: posterTicket.url,
      posterObjectKey,
      posterMethod: "PUT" as const,
      posterHeaders: { "Content-Type": args.posterContentType! },
      bucket: config.bucket,
      provider: config.provider,
      expiresAt,
    };
  },
});

export const completeExternalUpload = mutation({
  args: {
    jobId: v.id("cleaningJobs"),
    roomName: v.string(),
    photoType: photoTypeValidator,
    source: photoSourceValidator,
    notes: v.optional(v.string()),
    provider: v.string(),
    bucket: v.string(),
    objectKey: v.string(),
    objectVersion: v.optional(v.string()),
    contentType: v.string(),
    byteSize: v.number(),
    /** Defaults to `"image"`. */
    mediaKind: v.optional(mediaKindValidator),
    /** Required for `mediaKind === "video"`. Milliseconds. */
    durationMs: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    /** Required for `mediaKind === "video"`. Poster object reference. */
    posterObjectKey: v.optional(v.string()),
    posterBucket: v.optional(v.string()),
    posterProvider: v.optional(v.string()),
    posterByteSize: v.optional(v.number()),
    posterContentType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      throw new Error("Cleaning job not found");
    }

    const property = await ctx.db.get(job.propertyId);
    const roomName = normalizeRoomName(property, args.roomName);
    const mediaKind = args.mediaKind ?? "image";

    if (mediaKind === "video") {
      assertCanonicalVideo({
        mimeType: args.contentType,
        byteSize: args.byteSize,
        durationMs: args.durationMs,
      });
      if (
        !args.posterObjectKey ||
        !args.posterBucket ||
        !args.posterProvider
      ) {
        throw new Error(
          `[${ERROR_CODES.VIDEO_REQUIRES_POSTER}] ` +
            `Video upload completion is missing the poster reference.`,
        );
      }
      if (args.posterContentType) {
        assertCanonicalPoster({
          mimeType: args.posterContentType,
          byteSize: args.posterByteSize,
        });
      }
    }

    const photoId = await ctx.db.insert("photos", {
      cleaningJobId: args.jobId,
      roomName,
      type: args.photoType,
      source: args.source,
      notes: args.notes,
      uploadedBy: user._id,
      uploadedAt: Date.now(),
      provider: args.provider,
      bucket: args.bucket,
      objectKey: args.objectKey,
      objectVersion: args.objectVersion,
      byteSize: args.byteSize,
      archivedTier: "hot",
      mediaKind,
      // Video-only fields (undefined for image rows):
      durationMs: mediaKind === "video" ? args.durationMs : undefined,
      width: mediaKind === "video" ? args.width : undefined,
      height: mediaKind === "video" ? args.height : undefined,
      posterObjectKey:
        mediaKind === "video" ? args.posterObjectKey : undefined,
      posterBucket: mediaKind === "video" ? args.posterBucket : undefined,
      posterProvider:
        mediaKind === "video" ? args.posterProvider : undefined,
    });

    // Aggregate counts the *primary* object's bytes. Poster bytes are
    // tracked separately if/when we extend `photoStorageAggregate`; for v1
    // they're a small addition (~50–200 KB per video).
    await onPhotoInserted(ctx, {
      objectKey: args.objectKey,
      byteSize: args.byteSize,
    });

    // Mark the pending upload row as completed so the orphan cleanup cron
    // skips it. Best-effort — if it doesn't exist (legacy clients that
    // didn't go through the tracked path) we simply move on.
    await markPendingUploadCompleted(ctx, args.objectKey);

    let accessUrl: string | null = null;
    const readStartedAt = Date.now();
    try {
      accessUrl = await createExternalReadUrl({
        bucket: args.bucket,
        objectKey: args.objectKey,
      });
      await logB2Op(ctx, {
        feature: "b2_read_url",
        status: "success",
        durationMs: Date.now() - readStartedAt,
        userId: user._id,
        metadata: {
          bucket: args.bucket,
          provider: args.provider,
          mediaKind,
        },
      });
    } catch (error) {
      accessUrl = null;
      await logB2Op(ctx, {
        feature: "b2_read_url",
        status: "unknown_error",
        durationMs: Date.now() - readStartedAt,
        userId: user._id,
        errorMessage:
          (error instanceof Error ? error.message : String(error ?? "")).slice(
            0,
            500,
          ),
        metadata: {
          bucket: args.bucket,
          provider: args.provider,
          mediaKind,
        },
      });
    }

    return {
      photoId,
      accessUrl,
      mediaKind,
    };
  },
});

export const deleteJobPhoto = mutation({
  args: {
    photoId: v.id("photos"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    const photo = await ctx.db.get(args.photoId);
    if (!photo) {
      return false;
    }

    if (photo.storageId) {
      await ctx.storage.delete(photo.storageId);
    } else if (photo.objectKey) {
      const startedAt = Date.now();
      try {
        await deleteExternalObject({
          bucket: photo.bucket,
          objectKey: photo.objectKey,
        });
        await logB2Op(ctx, {
          feature: "b2_delete",
          status: "success",
          durationMs: Date.now() - startedAt,
          userId: user._id,
          metadata: {
            bucket: photo.bucket,
            provider: photo.provider,
            photoId: args.photoId,
            mediaKind: photo.mediaKind ?? "image",
          },
        });
      } catch (error) {
        console.warn(
          "[files/deleteJobPhoto] Failed to delete external object",
          error,
        );
        await logB2Op(ctx, {
          feature: "b2_delete",
          status: "unknown_error",
          durationMs: Date.now() - startedAt,
          userId: user._id,
          errorMessage:
            (error instanceof Error ? error.message : String(error ?? "")).slice(
              0,
              500,
            ),
          metadata: {
            bucket: photo.bucket,
            provider: photo.provider,
            photoId: args.photoId,
            mediaKind: photo.mediaKind ?? "image",
          },
        });
      }
    }

    // ─── Phase 1: also delete the poster for video rows ─────────────────
    if (photo.mediaKind === "video" && photo.posterObjectKey) {
      const posterStartedAt = Date.now();
      try {
        await deleteExternalObject({
          bucket: photo.posterBucket,
          objectKey: photo.posterObjectKey,
        });
        await logB2Op(ctx, {
          feature: "b2_delete",
          status: "success",
          durationMs: Date.now() - posterStartedAt,
          userId: user._id,
          metadata: {
            bucket: photo.posterBucket,
            provider: photo.posterProvider,
            photoId: args.photoId,
            kind: "poster",
          },
        });
      } catch (error) {
        // Best-effort: a stranded poster is harmless; the orphan cleanup
        // cron will eventually pick it up via its own sweep.
        console.warn(
          "[files/deleteJobPhoto] Failed to delete poster object",
          error,
        );
        await logB2Op(ctx, {
          feature: "b2_delete",
          status: "unknown_error",
          durationMs: Date.now() - posterStartedAt,
          userId: user._id,
          errorMessage:
            (error instanceof Error ? error.message : String(error ?? "")).slice(
              0,
              500,
            ),
          metadata: {
            bucket: photo.posterBucket,
            provider: photo.posterProvider,
            photoId: args.photoId,
            kind: "poster",
          },
        });
      }
    }

    await onPhotoDeleted(ctx, photo);
    await ctx.db.delete(args.photoId);
    return true;
  },
});

// ─── Object-key builders ────────────────────────────────────────────────────

function buildPhotoObjectKey(args: {
  jobId: string;
  photoType: "before" | "after" | "incident";
  fileName?: string;
}): string {
  const cleanedFileName = sanitizeFileName(args.fileName ?? `photo-${Date.now()}.jpg`);
  return `jobs/${args.jobId}/${args.photoType}/${Date.now()}-${cleanedFileName}`;
}

/**
 * Per ADR-0004: `videos/<jobId>/<uuid>.mp4`. We use a timestamp + short
 * random suffix as the uuid (Convex actions can't use crypto.randomUUID
 * cheaply from a mutation context, and the timestamp+random combo is
 * collision-resistant enough at our scale).
 */
function buildVideoObjectKey(args: {
  jobId: string;
  fileName?: string;
}): string {
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 10);
  const suffix = sanitizeFileName(args.fileName ?? "video.mp4");
  // Force the .mp4 extension since the canonical stored format is MP4.
  const base = suffix.replace(/\.[^.]+$/, "") || "video";
  return `videos/${args.jobId}/${stamp}-${rand}-${base}.mp4`;
}

function sanitizeFileName(fileName: string): string {
  const sanitized = fileName
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
  return sanitized || "photo.jpg";
}

// ─── Pending-upload tracking (used by orphan cleanup cron) ──────────────────

async function trackPendingUpload(
  ctx: MutationCtx,
  args: {
    cleaningJobId: Id<"cleaningJobs">;
    mediaKind: "image" | "video";
    provider: string;
    bucket: string;
    objectKey: string;
    posterObjectKey?: string;
    expiresAt: number;
  },
): Promise<void> {
  await ctx.db.insert("pendingMediaUploads", {
    cleaningJobId: args.cleaningJobId,
    mediaKind: args.mediaKind,
    provider: args.provider,
    bucket: args.bucket,
    objectKey: args.objectKey,
    posterObjectKey: args.posterObjectKey,
    expiresAt: args.expiresAt,
    status: "pending",
    createdAt: Date.now(),
  });
}

async function markPendingUploadCompleted(
  ctx: MutationCtx,
  objectKey: string,
): Promise<void> {
  const pending = await ctx.db
    .query("pendingMediaUploads")
    .withIndex("by_object_key", (q) => q.eq("objectKey", objectKey))
    .first();
  if (!pending) return;
  await ctx.db.patch(pending._id, { status: "completed" });
}
