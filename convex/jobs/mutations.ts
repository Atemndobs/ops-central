import { ConvexError, v } from "convex/values";
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
    try {
      const now = Date.now();
      const hasCleaner = Boolean(args.cleanerId);
      const title = args.title.trim();

      if (!title) {
        throw new ConvexError("Job title is required.");
      }

      if (!Number.isFinite(args.scheduledFor)) {
        throw new ConvexError("Scheduled date is invalid.");
      }

      const property = await ctx.db.get(args.propertyId);
      if (!property || !property.isActive) {
        throw new ConvexError("Selected property was not found.");
      }

      if (args.cleanerId) {
        const cleaner = await ctx.db.get(args.cleanerId);
        if (!cleaner) {
          throw new ConvexError("Selected cleaner was not found.");
        }
      }

      return await ctx.db.insert("jobs", {
        propertyId: args.propertyId,
        cleanerId: args.cleanerId,
        title,
        notes: args.notes?.trim(),
        scheduledFor: args.scheduledFor,
        status: hasCleaner ? "assigned" : "scheduled",
        photos: args.photoUrls?.map((url) => ({
          url,
          uploadedAt: now,
        })),
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      if (error instanceof ConvexError) {
        throw error;
      }
      throw new ConvexError("Unable to create job right now.");
    }
  },
});

export const updateStatus = mutation({
  args: {
    id: v.id("jobs"),
    status: jobStatusValidator,
  },
  handler: async (ctx, args) => {
    try {
      const job = await ctx.db.get(args.id);

      if (!job) {
        throw new ConvexError("Job not found.");
      }

      if (job.status === args.status) {
        return args.id;
      }

      const allowedNext = validTransitions[job.status] ?? [];
      if (!allowedNext.includes(args.status)) {
        throw new ConvexError("That status change is not allowed.");
      }

      await ctx.db.patch(args.id, {
        status: args.status,
        updatedAt: Date.now(),
      });

      return args.id;
    } catch (error) {
      if (error instanceof ConvexError) {
        throw error;
      }
      throw new ConvexError("Unable to update job status right now.");
    }
  },
});

export const assignCleaner = mutation({
  args: {
    id: v.id("jobs"),
    cleanerId: v.id("users"),
  },
  handler: async (ctx, args) => {
    try {
      const job = await ctx.db.get(args.id);

      if (!job) {
        throw new ConvexError("Job not found.");
      }

      const cleaner = await ctx.db.get(args.cleanerId);
      if (!cleaner) {
        throw new ConvexError("Cleaner not found.");
      }

      await ctx.db.patch(args.id, {
        cleanerId: args.cleanerId,
        status: job.status === "scheduled" ? "assigned" : job.status,
        updatedAt: Date.now(),
      });

      return args.id;
    } catch (error) {
      if (error instanceof ConvexError) {
        throw error;
      }
      throw new ConvexError("Unable to assign cleaner right now.");
    }
  },
});
