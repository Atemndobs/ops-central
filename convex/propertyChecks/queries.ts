import { v } from "convex/values";
import { query } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { getCurrentUser } from "../lib/auth";

async function resolveReferenceUrl(
  ctx: QueryCtx,
  args: {
    referenceStorageId?: Id<"_storage">;
    referenceImageUrl?: string;
  },
) {
  if (args.referenceStorageId) {
    const url = await ctx.storage.getUrl(args.referenceStorageId);
    if (url) {
      return url;
    }
  }
  return args.referenceImageUrl ?? null;
}

export const getByProperty = query({
  args: {
    propertyId: v.id("properties"),
    includeInactive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await getCurrentUser(ctx);

    const includeInactive = args.includeInactive ?? false;

    const rows = includeInactive
      ? await ctx.db
          .query("propertyCriticalCheckpoints")
          .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
          .collect()
      : await ctx.db
          .query("propertyCriticalCheckpoints")
          .withIndex("by_property_and_active", (q) =>
            q.eq("propertyId", args.propertyId).eq("isActive", true),
          )
          .collect();

    const withUrls = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        referenceUrl: await resolveReferenceUrl(ctx, {
          referenceStorageId: row.referenceStorageId,
          referenceImageUrl: row.referenceImageUrl,
        }),
      })),
    );

    return withUrls.sort((a, b) => {
      const roomOrder = a.roomName.localeCompare(b.roomName);
      if (roomOrder !== 0) {
        return roomOrder;
      }
      if (a.sortOrder !== b.sortOrder) {
        return a.sortOrder - b.sortOrder;
      }
      return a.title.localeCompare(b.title);
    });
  },
});

export const getForJob = query({
  args: {
    jobId: v.id("cleaningJobs"),
    includeInactive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await getCurrentUser(ctx);

    const job = await ctx.db.get(args.jobId);
    if (!job) {
      return [];
    }

    const includeInactive = args.includeInactive ?? false;
    const rows = includeInactive
      ? await ctx.db
          .query("propertyCriticalCheckpoints")
          .withIndex("by_property", (q) => q.eq("propertyId", job.propertyId))
          .collect()
      : await ctx.db
          .query("propertyCriticalCheckpoints")
          .withIndex("by_property_and_active", (q) =>
            q.eq("propertyId", job.propertyId).eq("isActive", true),
          )
          .collect();

    const withUrls = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        referenceUrl: await resolveReferenceUrl(ctx, {
          referenceStorageId: row.referenceStorageId,
          referenceImageUrl: row.referenceImageUrl,
        }),
      })),
    );

    return withUrls.sort((a, b) => {
      const roomOrder = a.roomName.localeCompare(b.roomName);
      if (roomOrder !== 0) {
        return roomOrder;
      }
      if (a.sortOrder !== b.sortOrder) {
        return a.sortOrder - b.sortOrder;
      }
      return a.title.localeCompare(b.title);
    });
  },
});
