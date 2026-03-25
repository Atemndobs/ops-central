import { query } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser } from "../lib/auth";

export const getFileUrl = query({
  args: {
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await getCurrentUser(ctx);
    return await ctx.storage.getUrl(args.storageId);
  },
});

export const getPhotoUrl = query({
  args: {
    photoId: v.id("photos"),
  },
  handler: async (ctx, args) => {
    await getCurrentUser(ctx);

    const photo = await ctx.db.get(args.photoId);
    if (!photo) {
      return null;
    }

    return await ctx.storage.getUrl(photo.storageId);
  },
});
