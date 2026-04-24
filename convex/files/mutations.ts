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
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

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
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      throw new Error("Cleaning job not found");
    }

    const config = requireExternalStorageConfig();
    const objectKey = buildPhotoObjectKey({
      jobId: args.jobId,
      photoType: args.photoType,
      fileName: args.fileName,
    });

    const startedAt = Date.now();
    const { url, expiresAt } = await createExternalUploadUrl({
      bucket: config.bucket,
      objectKey,
      contentType: args.contentType,
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
      },
    });

    return {
      url,
      method: "PUT",
      headers: {
        "Content-Type": args.contentType,
      },
      objectKey,
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
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      throw new Error("Cleaning job not found");
    }

    const property = await ctx.db.get(job.propertyId);
    const roomName = normalizeRoomName(property, args.roomName);

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
    });

    await onPhotoInserted(ctx, {
      objectKey: args.objectKey,
      byteSize: args.byteSize,
    });

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
        metadata: { bucket: args.bucket, provider: args.provider },
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
        metadata: { bucket: args.bucket, provider: args.provider },
      });
    }

    return {
      photoId,
      accessUrl,
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
          },
        });
      } catch (error) {
        console.warn("[files/deleteJobPhoto] Failed to delete external object", error);
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
          },
        });
      }
    }

    await onPhotoDeleted(ctx, photo);
    await ctx.db.delete(args.photoId);
    return true;
  },
});

function buildPhotoObjectKey(args: {
  jobId: string;
  photoType: "before" | "after" | "incident";
  fileName?: string;
}): string {
  const cleanedFileName = sanitizeFileName(args.fileName ?? `photo-${Date.now()}.jpg`);
  return `jobs/${args.jobId}/${args.photoType}/${Date.now()}-${cleanedFileName}`;
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
