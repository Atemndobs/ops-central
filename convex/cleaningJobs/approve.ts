import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { getCurrentUser } from "../lib/auth";

function requireApproverRole(user: Doc<"users">) {
  if (
    user.role !== "admin" &&
    user.role !== "manager" &&
    user.role !== "property_ops"
  ) {
    throw new ConvexError("Only managers, property ops, or admins can approve.");
  }
}

export const submitForApproval = mutation({
  args: {
    jobId: v.id("cleaningJobs"),
  },
  handler: async (ctx, args) => {
    await getCurrentUser(ctx);
    const job = await ctx.db.get(args.jobId);

    if (!job) {
      throw new ConvexError("Job not found.");
    }
    if (job.status !== "in_progress" && job.status !== "awaiting_approval") {
      throw new ConvexError(
        `Cannot submit for approval: job is currently "${job.status}".`,
      );
    }

    if (job.status === "in_progress") {
      await ctx.db.patch(args.jobId, {
        status: "awaiting_approval",
        updatedAt: Date.now(),
      });
    }

    return args.jobId;
  },
});

export const approveCompletion = mutation({
  args: {
    jobId: v.id("cleaningJobs"),
    approvalNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    requireApproverRole(user);

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
      approvedBy: user._id,
      managerNotes: args.approvalNotes,
      updatedAt: Date.now(),
    });

    return args.jobId;
  },
});

export const rejectCompletion = mutation({
  args: {
    jobId: v.id("cleaningJobs"),
    rejectionReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    requireApproverRole(user);

    const job = await ctx.db.get(args.jobId);
    if (!job) {
      throw new ConvexError("Job not found.");
    }
    if (job.status !== "awaiting_approval") {
      throw new ConvexError(
        `Cannot reject: job is currently "${job.status}".`,
      );
    }

    const now = Date.now();
    const nextRevision = (job.currentRevision ?? 1) + 1;
    if (job.latestSubmissionId) {
      await ctx.db.patch(job.latestSubmissionId, {
        status: "superseded",
        supersededAt: now,
      });
    }

    await ctx.db.patch(args.jobId, {
      status: "rework_required",
      currentRevision: nextRevision,
      actualStartAt: undefined,
      actualEndAt: undefined,
      latestSubmissionId: undefined,
      rejectedAt: now,
      rejectedBy: user._id,
      rejectionReason: args.rejectionReason?.trim(),
      updatedAt: now,
    });

    return args.jobId;
  },
});

export const reopenCompleted = mutation({
  args: {
    jobId: v.id("cleaningJobs"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    requireApproverRole(user);

    const job = await ctx.db.get(args.jobId);
    if (!job) {
      throw new ConvexError("Job not found.");
    }
    if (job.status !== "completed") {
      throw new ConvexError(
        `Cannot reopen: job is currently "${job.status}".`,
      );
    }

    const now = Date.now();
    const nextRevision = (job.currentRevision ?? 1) + 1;
    if (job.latestSubmissionId) {
      await ctx.db.patch(job.latestSubmissionId, {
        status: "superseded",
        supersededAt: now,
      });
    }

    await ctx.db.patch(args.jobId, {
      status: "rework_required",
      currentRevision: nextRevision,
      actualStartAt: undefined,
      actualEndAt: undefined,
      latestSubmissionId: undefined,
      rejectedAt: now,
      rejectedBy: user._id,
      rejectionReason: args.reason?.trim(),
      updatedAt: now,
    });

    return args.jobId;
  },
});
