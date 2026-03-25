import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";

export const create = mutation({
  args: {
    propertyId: v.id("properties"),
    scheduledStartAt: v.number(),
    scheduledEndAt: v.number(),
    notesForCleaner: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const property = await ctx.db.get(args.propertyId);
    if (!property) {
      throw new ConvexError("Property not found.");
    }
    if (!property.isActive) {
      throw new ConvexError("Property is not active.");
    }

    if (
      !Number.isFinite(args.scheduledStartAt) ||
      !Number.isFinite(args.scheduledEndAt)
    ) {
      throw new ConvexError("Scheduled dates are invalid.");
    }

    const now = Date.now();

    return await ctx.db.insert("cleaningJobs", {
      propertyId: args.propertyId,
      assignedCleanerIds: [],
      status: "scheduled",
      scheduledStartAt: args.scheduledStartAt,
      scheduledEndAt: args.scheduledEndAt,
      notesForCleaner: args.notesForCleaner?.trim(),
      partyRiskFlag: false,
      opsRiskFlag: false,
      isUrgent: false,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const start = mutation({
  args: {
    jobId: v.id("cleaningJobs"),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      throw new ConvexError("Job not found.");
    }
    if (job.status !== "assigned") {
      throw new ConvexError(
        `Job cannot be started from status "${job.status}". Job must be in "assigned" status.`,
      );
    }

    await ctx.db.patch(args.jobId, {
      status: "in_progress",
      actualStartAt: Date.now(),
      updatedAt: Date.now(),
    });

    return args.jobId;
  },
});

export const complete = mutation({
  args: {
    jobId: v.id("cleaningJobs"),
    notes: v.optional(v.string()),
    guestReady: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      throw new ConvexError("Job not found.");
    }
    if (job.status !== "in_progress") {
      throw new ConvexError(
        `Job cannot be completed from status "${job.status}". Job must be in "in_progress" status.`,
      );
    }

    const now = Date.now();

    await ctx.db.patch(args.jobId, {
      status: "completed",
      actualEndAt: now,
      completionNotes: args.notes?.trim(),
      updatedAt: now,
    });

    return args.jobId;
  },
});

export const assign = mutation({
  args: {
    jobId: v.id("cleaningJobs"),
    cleanerIds: v.array(v.id("users")),
    notifyCleaners: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      throw new ConvexError("Job not found.");
    }

    // Validate each cleaner exists
    for (const cleanerId of args.cleanerIds) {
      const cleaner = await ctx.db.get(cleanerId);
      if (!cleaner) {
        throw new ConvexError(`Cleaner not found: ${cleanerId}`);
      }
    }

    const updatedStatus =
      job.status === "scheduled" ? "assigned" : job.status;

    await ctx.db.patch(args.jobId, {
      assignedCleanerIds: args.cleanerIds,
      status: updatedStatus,
      updatedAt: Date.now(),
    });

    return args.jobId;
  },
});
