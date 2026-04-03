import { ConvexError, v } from "convex/values";
import { query } from "../_generated/server";
import { getCurrentUser } from "../lib/auth";
import type { Doc } from "../_generated/dataModel";

function isPrivilegedRole(user: Doc<"users">): boolean {
  return (
    user.role === "admin" ||
    user.role === "property_ops" ||
    user.role === "manager"
  );
}

function assertJobAccess(user: Doc<"users">, job: Doc<"cleaningJobs">) {
  if (isPrivilegedRole(user)) {
    return;
  }
  if (user.role === "cleaner" && job.assignedCleanerIds.includes(user._id)) {
    return;
  }
  throw new ConvexError("You are not authorized to access refill checks for this job.");
}

function sortTrackedItems(items: Doc<"inventoryItems">[]) {
  return items.sort((a, b) => {
    const roomA = a.room ?? "";
    const roomB = b.room ?? "";
    const roomOrder = roomA.localeCompare(roomB);
    if (roomOrder !== 0) {
      return roomOrder;
    }
    const displayA = a.refillDisplayOrder ?? Number.MAX_SAFE_INTEGER;
    const displayB = b.refillDisplayOrder ?? Number.MAX_SAFE_INTEGER;
    if (displayA !== displayB) {
      return displayA - displayB;
    }
    return a.name.localeCompare(b.name);
  });
}

export const getTrackedItemsByProperty = query({
  args: {
    propertyId: v.id("properties"),
  },
  handler: async (ctx, args) => {
    await getCurrentUser(ctx);

    const items = await ctx.db
      .query("inventoryItems")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();

    return sortTrackedItems(items.filter((item) => item.isRefillTracked === true));
  },
});

export const getTrackedItemsForJob = query({
  args: {
    jobId: v.id("cleaningJobs"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      return [];
    }
    assertJobAccess(user, job);

    const items = await ctx.db
      .query("inventoryItems")
      .withIndex("by_property", (q) => q.eq("propertyId", job.propertyId))
      .collect();
    return sortTrackedItems(items.filter((item) => item.isRefillTracked === true));
  },
});

export const getJobRefillChecks = query({
  args: {
    jobId: v.id("cleaningJobs"),
    revision: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      return [];
    }
    assertJobAccess(user, job);

    const revision = args.revision ?? (job.currentRevision ?? 1);
    const rows = await ctx.db
      .query("jobRefillChecks")
      .withIndex("by_job_and_revision", (q) =>
        q.eq("jobId", args.jobId).eq("revision", revision),
      )
      .collect();

    return rows.sort((a, b) => b.checkedAt - a.checkedAt);
  },
});

export const getQueue = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("open"),
        v.literal("acknowledged"),
        v.literal("ordered"),
        v.literal("resolved"),
      ),
    ),
    propertyId: v.optional(v.id("properties")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!isPrivilegedRole(user)) {
      throw new ConvexError("Only privileged users can access refill queue.");
    }

    const limit =
      typeof args.limit === "number" && Number.isFinite(args.limit)
        ? Math.max(1, Math.min(500, Math.floor(args.limit)))
        : 200;

    let queueRows: Doc<"refillQueue">[];
    if (args.status && args.propertyId) {
      queueRows = await ctx.db
        .query("refillQueue")
        .withIndex("by_property_and_status", (q) =>
          q.eq("propertyId", args.propertyId!).eq("status", args.status!),
        )
        .collect();
    } else if (args.status) {
      queueRows = await ctx.db
        .query("refillQueue")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .collect();
    } else if (args.propertyId) {
      queueRows = (await ctx.db.query("refillQueue").collect()).filter(
        (row) => row.propertyId === args.propertyId,
      );
    } else {
      queueRows = await ctx.db.query("refillQueue").collect();
    }

    const [items, properties] = await Promise.all([
      Promise.all(queueRows.map((row) => ctx.db.get(row.itemId))),
      Promise.all(queueRows.map((row) => ctx.db.get(row.propertyId))),
    ]);

    const itemById = new Map(
      items
        .filter((item): item is NonNullable<typeof item> => item !== null)
        .map((item) => [item._id, item] as const),
    );
    const propertyById = new Map(
      properties
        .filter((property): property is NonNullable<typeof property> => property !== null)
        .map((property) => [property._id, property] as const),
    );

    return queueRows
      .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))
      .slice(0, limit)
      .map((row) => ({
        ...row,
        item: itemById.get(row.itemId) ?? null,
        property: propertyById.get(row.propertyId) ?? null,
      }));
  },
});
