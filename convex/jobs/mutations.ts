import { v } from "convex/values";
import { mutation } from "../_generated/server";

const jobStatusValidator = v.union(
  v.literal("scheduled"),
  v.literal("assigned"),
  v.literal("in_progress"),
  v.literal("completed"),
  v.literal("approved"),
  v.literal("cancelled"),
);

const validTransitions: Record<string, string[]> = {
  scheduled: ["assigned", "cancelled"],
  assigned: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: ["approved"],
  approved: [],
  cancelled: [],
};

export const create = mutation({
  args: {
    propertyId: v.id("properties"),
    cleanerId: v.optional(v.id("users")),
    title: v.string(),
    notes: v.optional(v.string()),
    scheduledFor: v.number(),
    photoUrls: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const hasCleaner = Boolean(args.cleanerId);

    return await ctx.db.insert("jobs", {
      propertyId: args.propertyId,
      cleanerId: args.cleanerId,
      title: args.title,
      notes: args.notes,
      scheduledFor: args.scheduledFor,
      status: hasCleaner ? "assigned" : "scheduled",
      photos: args.photoUrls?.map((url) => ({
        url,
        uploadedAt: now,
      })),
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateStatus = mutation({
  args: {
    id: v.id("jobs"),
    status: jobStatusValidator,
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.id);

    if (!job) {
      throw new Error("Job not found.");
    }

    if (job.status === args.status) {
      return args.id;
    }

    const allowedNext = validTransitions[job.status] ?? [];
    if (!allowedNext.includes(args.status)) {
      throw new Error(`Invalid status transition: ${job.status} -> ${args.status}`);
    }

    await ctx.db.patch(args.id, {
      status: args.status,
      updatedAt: Date.now(),
    });

    return args.id;
  },
});

export const assignCleaner = mutation({
  args: {
    id: v.id("jobs"),
    cleanerId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.id);

    if (!job) {
      throw new Error("Job not found.");
    }

    await ctx.db.patch(args.id, {
      cleanerId: args.cleanerId,
      status: job.status === "scheduled" ? "assigned" : job.status,
      updatedAt: Date.now(),
    });

    return args.id;
  },
});
