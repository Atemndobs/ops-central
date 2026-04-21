import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser } from "../lib/auth";
import {
  createExternalReadUrl,
  createExternalUploadUrl,
  deleteExternalObject,
  requireExternalStorageConfig,
} from "../lib/externalStorage";
import { normalizeRoomName } from "../lib/rooms";

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
    await getCurrentUser(ctx);
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

    const { url, expiresAt } = await createExternalUploadUrl({
      bucket: config.bucket,
      objectKey,
      contentType: args.contentType,
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
      archivedTier: "hot",
    });

    let accessUrl: string | null = null;
    try {
      accessUrl = await createExternalReadUrl({
        bucket: args.bucket,
        objectKey: args.objectKey,
      });
    } catch {
      accessUrl = null;
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
    await getCurrentUser(ctx);

    const photo = await ctx.db.get(args.photoId);
    if (!photo) {
      return false;
    }

    if (photo.storageId) {
      await ctx.storage.delete(photo.storageId);
    } else if (photo.objectKey) {
      try {
        await deleteExternalObject({
          bucket: photo.bucket,
          objectKey: photo.objectKey,
        });
      } catch (error) {
        console.warn("[files/deleteJobPhoto] Failed to delete external object", error);
      }
    }

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
