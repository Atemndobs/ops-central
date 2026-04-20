/**
 * DEV-ONLY: Reset completed/cancelled jobs back to "scheduled" for testing.
 *
 * Clears all execution data (sessions, submissions, approval fields) so
 * jobs can be re-assigned and re-run by cleaners.
 *
 * Usage:
 *   npx convex run cleaningJobs/devResetJobs:resetCompleted
 *
 * With options:
 *   npx convex run cleaningJobs/devResetJobs:resetCompleted '{"dryRun": true}'
 *   npx convex run cleaningJobs/devResetJobs:resetCompleted '{"includeStatuses": ["completed", "cancelled"]}'
 */
import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export const resetCompleted = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    includeStatuses: v.optional(
      v.array(
        v.union(
          v.literal("completed"),
          v.literal("cancelled"),
          v.literal("awaiting_approval"),
          v.literal("in_progress"),
          v.literal("rework_required"),
        ),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const statuses = args.includeStatuses ?? ["completed"];
    const dryRun = args.dryRun ?? false;

    let totalReset = 0;
    let totalSessionsDeleted = 0;
    let totalSubmissionsDeleted = 0;

    for (const status of statuses) {
      const jobs = await ctx.db
        .query("cleaningJobs")
        .withIndex("by_status", (q) => q.eq("status", status))
        .collect();

      for (const job of jobs) {
        if (dryRun) {
          totalReset++;
          continue;
        }

        // Delete execution sessions for this job
        const sessions = await ctx.db
          .query("jobExecutionSessions")
          .withIndex("by_job_and_revision", (q) => q.eq("jobId", job._id))
          .collect();
        for (const session of sessions) {
          await ctx.db.delete(session._id);
          totalSessionsDeleted++;
        }

        // Delete submissions for this job
        const submissions = await ctx.db
          .query("jobSubmissions")
          .withIndex("by_job", (q) => q.eq("jobId", job._id))
          .collect();
        for (const submission of submissions) {
          await ctx.db.delete(submission._id);
          totalSubmissionsDeleted++;
        }

        // Reset the job to scheduled
        await ctx.db.patch(job._id, {
          status: "assigned",
          actualStartAt: undefined,
          actualEndAt: undefined,
          approvedAt: undefined,
          approvedBy: undefined,
          rejectedAt: undefined,
          rejectedBy: undefined,
          rejectionReason: undefined,
          latestSubmissionId: undefined,
          currentRevision: 1,
          completionNotes: undefined,
          checklistItems: undefined,
          updatedAt: Date.now(),
        });

        totalReset++;
      }
    }

    const mode = dryRun ? "[DRY RUN] " : "";
    return {
      message: `${mode}Reset ${totalReset} jobs (${statuses.join(", ")})`,
      jobsReset: totalReset,
      sessionsDeleted: totalSessionsDeleted,
      submissionsDeleted: totalSubmissionsDeleted,
      dryRun,
    };
  },
});

/**
 * DEV-ONLY: Reset a single cleaning job by ID back to "assigned".
 *
 * Usage:
 *   npx convex run cleaningJobs/devResetJobs:resetById '{"jobId":"<id>"}'
 *   npx convex run cleaningJobs/devResetJobs:resetById '{"jobId":"<id>","dryRun":true}'
 */
export const resetById = internalMutation({
  args: {
    jobId: v.string(),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? false;
    const jobId = args.jobId as Id<"cleaningJobs">;
    const job = await ctx.db.get(jobId);
    if (!job) {
      throw new Error(`Job ${args.jobId} not found`);
    }

    let sessionsDeleted = 0;
    let submissionsDeleted = 0;

    if (!dryRun) {
      const sessions = await ctx.db
        .query("jobExecutionSessions")
        .withIndex("by_job_and_revision", (q) => q.eq("jobId", job._id))
        .collect();
      for (const session of sessions) {
        await ctx.db.delete(session._id);
        sessionsDeleted++;
      }

      const submissions = await ctx.db
        .query("jobSubmissions")
        .withIndex("by_job", (q) => q.eq("jobId", job._id))
        .collect();
      for (const submission of submissions) {
        await ctx.db.delete(submission._id);
        submissionsDeleted++;
      }

      await ctx.db.patch(job._id, {
        status: "assigned",
        actualStartAt: undefined,
        actualEndAt: undefined,
        approvedAt: undefined,
        approvedBy: undefined,
        rejectedAt: undefined,
        rejectedBy: undefined,
        rejectionReason: undefined,
        latestSubmissionId: undefined,
        currentRevision: 1,
        completionNotes: undefined,
        checklistItems: undefined,
        updatedAt: Date.now(),
      });
    }

    const mode = dryRun ? "[DRY RUN] " : "";
    return {
      message: `${mode}Reset job ${job._id} (was ${job.status})`,
      jobId: job._id,
      previousStatus: job.status,
      sessionsDeleted,
      submissionsDeleted,
      dryRun,
    };
  },
});
