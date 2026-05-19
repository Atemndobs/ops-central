/**
 * DEV-ONLY: Reset jobs back to "scheduled" for testing.
 *
 * Clears all execution data and unassigns cleaners so jobs can be
 * re-scheduled, re-assigned, and re-run from a clean slate.
 *
 * What it does per job:
 *  - status → "scheduled"
 *  - assignedCleanerIds → []
 *  - acknowledgements → []
 *  - clears actualStartAt/EndAt, approval/rejection fields, latestSubmissionId,
 *    completionNotes, checklistItems
 *  - currentRevision → 1
 *  - deletes jobExecutionSessions for the job
 *  - deletes jobSubmissions for the job
 *  - deletes userJobAssignments reverse-index rows for the job
 *  - detaches photos by nulling `cleaningJobId` (photo rows preserved)
 *
 * Usage:
 *   # All completed jobs
 *   npx convex run cleaningJobs/devResetJobs:resetCompleted
 *
 *   # Specific job
 *   npx convex run cleaningJobs/devResetJobs:resetCompleted '{"jobId": "kx7583emf1vgsejwrhwvecty3n86k3hq"}'
 *
 *   # Dry-run
 *   npx convex run cleaningJobs/devResetJobs:resetCompleted '{"dryRun": true}'
 *
 *   # Filter statuses
 *   npx convex run cleaningJobs/devResetJobs:resetCompleted '{"includeStatuses": ["completed","in_progress","awaiting_approval"]}'
 */
import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

export const resetCompleted = internalMutation({
  args: {
    jobId: v.optional(v.id("cleaningJobs")),
    dryRun: v.optional(v.boolean()),
    includeStatuses: v.optional(
      v.array(
        v.union(
          v.literal("scheduled"),
          v.literal("assigned"),
          v.literal("in_progress"),
          v.literal("awaiting_approval"),
          v.literal("rework_required"),
          v.literal("completed"),
          v.literal("cancelled"),
        ),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? false;

    let jobs: Doc<"cleaningJobs">[] = [];
    if (args.jobId) {
      const job = await ctx.db.get(args.jobId);
      if (job) jobs = [job];
    } else {
      const statuses = args.includeStatuses ?? ["completed"];
      for (const status of statuses) {
        const batch = await ctx.db
          .query("cleaningJobs")
          .withIndex("by_status", (q) => q.eq("status", status))
          .collect();
        jobs.push(...batch);
      }
    }

    let totalReset = 0;
    let totalSessionsDeleted = 0;
    let totalSubmissionsDeleted = 0;
    let totalAssignmentsDeleted = 0;
    let totalPhotosDetached = 0;

    for (const job of jobs) {
      if (dryRun) {
        totalReset++;
        const [sessions, submissions, assignments, photos] = await Promise.all([
          ctx.db.query("jobExecutionSessions").withIndex("by_job_and_revision", (q) => q.eq("jobId", job._id)).collect(),
          ctx.db.query("jobSubmissions").withIndex("by_job", (q) => q.eq("jobId", job._id)).collect(),
          ctx.db.query("userJobAssignments").withIndex("by_job", (q) => q.eq("jobId", job._id)).collect(),
          ctx.db.query("photos").withIndex("by_job", (q) => q.eq("cleaningJobId", job._id)).collect(),
        ]);
        totalSessionsDeleted += sessions.length;
        totalSubmissionsDeleted += submissions.length;
        totalAssignmentsDeleted += assignments.length;
        totalPhotosDetached += photos.length;
        continue;
      }

      const sessions = await ctx.db
        .query("jobExecutionSessions")
        .withIndex("by_job_and_revision", (q) => q.eq("jobId", job._id))
        .collect();
      for (const session of sessions) {
        await ctx.db.delete(session._id);
        totalSessionsDeleted++;
      }

      const submissions = await ctx.db
        .query("jobSubmissions")
        .withIndex("by_job", (q) => q.eq("jobId", job._id))
        .collect();
      for (const submission of submissions) {
        await ctx.db.delete(submission._id);
        totalSubmissionsDeleted++;
      }

      const assignments = await ctx.db
        .query("userJobAssignments")
        .withIndex("by_job", (q) => q.eq("jobId", job._id))
        .collect();
      for (const row of assignments) {
        await ctx.db.delete(row._id);
        totalAssignmentsDeleted++;
      }

      const photos = await ctx.db
        .query("photos")
        .withIndex("by_job", (q) => q.eq("cleaningJobId", job._id))
        .collect();
      for (const photo of photos) {
        await ctx.db.patch(photo._id, { cleaningJobId: undefined });
        totalPhotosDetached++;
      }

      await ctx.db.patch(job._id, {
        status: "scheduled",
        assignedCleanerIds: [] as Id<"users">[],
        acknowledgements: [],
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

    const mode = dryRun ? "[DRY RUN] " : "";
    const scope = args.jobId
      ? `job ${args.jobId}`
      : `statuses ${(args.includeStatuses ?? ["completed"]).join(", ")}`;
    return {
      message: `${mode}Reset ${totalReset} job(s) (${scope})`,
      jobsReset: totalReset,
      sessionsDeleted: totalSessionsDeleted,
      submissionsDeleted: totalSubmissionsDeleted,
      assignmentsDeleted: totalAssignmentsDeleted,
      photosDetached: totalPhotosDetached,
      dryRun,
    };
  },
});
