/**
 * DEV-ONLY: Clear stale execution timers.
 *
 * For any cleaningJob whose status is NOT actively running (i.e. not
 * `in_progress`, `awaiting_approval`, or `completed`), deletes its
 * `jobExecutionSessions` and clears `actualStartAt` / `actualEndAt`.
 *
 * Why: `unassignFuture` (2026-05-17) reset job statuses back to `scheduled`
 * but left `jobExecutionSessions` rows in place. The job-detail timer derives
 * `effectiveStartAt` from the earliest session's `startedAtServer`, so the
 * UI keeps counting "elapsed" against jobs that were never actually started.
 *
 * Usage:
 *   npx convex run cleaningJobs/devClearStaleTimers:clearStaleSessions
 *   npx convex run cleaningJobs/devClearStaleTimers:clearStaleSessions '{"dryRun": true}'
 */
import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

const STATUSES_TO_CLEAR = [
  "scheduled",
  "assigned",
  "rework_required",
  "cancelled",
] as const;

export const clearStaleSessions = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? false;
    const now = Date.now();

    let jobsTouched = 0;
    let sessionsDeleted = 0;
    let actualTimesCleared = 0;
    const sample: Array<{ id: string; status: string; sessions: number }> = [];

    for (const status of STATUSES_TO_CLEAR) {
      const jobs = await ctx.db
        .query("cleaningJobs")
        .withIndex("by_status", (q) => q.eq("status", status))
        .collect();

      for (const job of jobs) {
        const sessions = await ctx.db
          .query("jobExecutionSessions")
          .withIndex("by_job_and_revision", (q) => q.eq("jobId", job._id))
          .collect();

        const hasActualTimes =
          job.actualStartAt !== undefined || job.actualEndAt !== undefined;

        if (sessions.length === 0 && !hasActualTimes) continue;

        jobsTouched++;
        if (sample.length < 10) {
          sample.push({
            id: job._id,
            status: job.status,
            sessions: sessions.length,
          });
        }

        if (dryRun) {
          sessionsDeleted += sessions.length;
          if (hasActualTimes) actualTimesCleared++;
          continue;
        }

        for (const session of sessions) {
          await ctx.db.delete(session._id);
          sessionsDeleted++;
        }

        if (hasActualTimes) {
          await ctx.db.patch(job._id, {
            actualStartAt: undefined,
            actualEndAt: undefined,
            updatedAt: now,
          });
          actualTimesCleared++;
        }
      }
    }

    return {
      dryRun,
      statusesScanned: STATUSES_TO_CLEAR,
      jobsTouched,
      sessionsDeleted,
      actualTimesCleared,
      sample,
      message:
        (dryRun ? "[DRY RUN] would clear " : "cleared ") +
        sessionsDeleted +
        " sessions across " +
        jobsTouched +
        " jobs",
    };
  },
});
