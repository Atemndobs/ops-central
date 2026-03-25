import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser } from "../lib/auth";

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
    photoType: v.union(
      v.literal("before"),
      v.literal("after"),
      v.literal("incident")
    ),
    source: v.union(
      v.literal("app"),
      v.literal("whatsapp"),
      v.literal("manual")
    ),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    const job = await ctx.db.get(args.jobId);
    if (!job) {
      throw new Error("Cleaning job not found");
    }

    return await ctx.db.insert("photos", {
      cleaningJobId: args.jobId,
      storageId: args.storageId,
      roomName: args.roomName,
      type: args.photoType,
      source: args.source,
      notes: args.notes,
      uploadedBy: user._id,
      uploadedAt: Date.now(),
    });
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

    await ctx.storage.delete(photo.storageId);
    await ctx.db.delete(args.photoId);
    return true;
  },
});
