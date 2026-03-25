import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";

export const submitForApproval = mutation({
  args: {
    jobId: v.id("cleaningJobs"),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);

    if (!job) {
      throw new ConvexError("Job not found.");
    }

    if (job.status !== "in_progress" && job.status !== "completed") {
      throw new ConvexError(
        `Cannot submit for approval: job is currently "${job.status}". Only jobs that are in_progress or completed can be submitted.`,
      );
    }

    await ctx.db.patch(args.jobId, {
      status: "awaiting_approval",
      updatedAt: Date.now(),
    });

    return args.jobId;
  },
});

export const approveCompletion = mutation({
  args: {
    jobId: v.id("cleaningJobs"),
    approvalNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);

    if (!job) {
      throw new ConvexError("Job not found.");
    }

    if (job.status !== "awaiting_approval") {
      throw new ConvexError(
        `Cannot approve: job is currently "${job.status}". Only jobs awaiting_approval can be approved.`,
      );
    }

    await ctx.db.patch(args.jobId, {
      status: "completed",
      approvedAt: Date.now(),
      managerNotes: args.approvalNotes,
      updatedAt: Date.now(),
    });

    return args.jobId;
  },
});
