/**
 * Bulk-unassign cleaners from upcoming cleaning jobs.
 *
 * Pre-go-live (2026-05-17): wiping cleaner assignments on jobs scheduled
 * for 2026-05-18 onward so Jesse can re-assign cleanly with the actual
 * Sofia Cleaning roster.
 *
 * For each `cleaningJob` with `scheduledStartAt >= cutoff` AND
 * `assignedCleanerIds.length > 0` AND status NOT terminal (completed,
 * cancelled):
 *   - clear assignedCleanerIds → []
 *   - clear acknowledgements → []
 *   - if status was `assigned` or `in_progress` → reset to `scheduled`
 *   - if status was `in_progress` → also clear actualStartAt / actualEndAt /
 *     latestSubmissionId / currentRevision
 *   - append audit note to managerNotes
 *   - delete matching rows from the `userJobAssignments` reverse-index
 *
 * Does NOT touch:
 *   - `assignedManagerId` (separate concern)
 *   - jobs scheduled before cutoff (markPastDone handled those)
 *   - completed / cancelled jobs (real history)
 *   - jobAssignmentAuditEvents (audit trail stays)
 *
 * Usage:
 *   npx convex run cleaningJobs/unassignFuture:unassignFuture '{"dryRun": true}'
 *   npx convex run cleaningJobs/unassignFuture:unassignFuture '{}'
 *
 *   # Custom cutoff (ms epoch)
 *   npx convex run cleaningJobs/unassignFuture:unassignFuture '{"cutoffMs": 1779080400000}'
 */
import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

// 2026-05-18T05:00:00Z = 2026-05-18 00:00 America/Chicago (CDT)
const DEFAULT_CUTOFF_MS = 1779080400000;

const RESET_FROM_STATUSES = new Set(["assigned", "in_progress"]);
const SKIP_TERMINAL_STATUSES = new Set(["completed", "cancelled"]);

export const unassignFuture = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    cutoffMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const cutoff = args.cutoffMs ?? DEFAULT_CUTOFF_MS;
    const dryRun = args.dryRun ?? false;
    const now = Date.now();

    // Read upcoming jobs via by_scheduled.
    const upcoming = await ctx.db
      .query("cleaningJobs")
      .withIndex("by_scheduled", (q) => q.gte("scheduledStartAt", cutoff))
      .collect();

    const samples: Array<{
      id: string;
      status: string;
      cleanerCount: number;
      scheduledStartAt: number;
    }> = [];
    let touched = 0;
    let assignmentRowsDeleted = 0;
    let resetToScheduled = 0;
    const beforeStatusCounts: Record<string, number> = {};

    for (const job of upcoming) {
      if (SKIP_TERMINAL_STATUSES.has(job.status)) continue;
      if ((job.assignedCleanerIds?.length ?? 0) === 0) continue;

      beforeStatusCounts[job.status] = (beforeStatusCounts[job.status] ?? 0) + 1;
      touched++;

      if (samples.length < 10) {
        samples.push({
          id: job._id,
          status: job.status,
          cleanerCount: job.assignedCleanerIds.length,
          scheduledStartAt: job.scheduledStartAt,
        });
      }

      if (dryRun) {
        // Still count the reverse-index rows we'd remove for visibility.
        const rows = await ctx.db
          .query("userJobAssignments")
          .withIndex("by_job", (q) => q.eq("jobId", job._id))
          .collect();
        assignmentRowsDeleted += rows.length;
        continue;
      }

      const shouldReset = RESET_FROM_STATUSES.has(job.status);
      const wasInProgress = job.status === "in_progress";
      if (shouldReset) resetToScheduled++;

      const patch: Record<string, unknown> = {
        assignedCleanerIds: [],
        acknowledgements: [],
        updatedAt: now,
        managerNotes:
          (job.managerNotes ? job.managerNotes + "\n\n" : "") +
          `[unassigned pre-go-live 2026-05-17 — was status: ${job.status}, ${job.assignedCleanerIds.length} cleaner(s)]`,
      };
      if (shouldReset) {
        patch.status = "scheduled";
      }
      if (wasInProgress) {
        patch.actualStartAt = undefined;
        patch.actualEndAt = undefined;
        patch.latestSubmissionId = undefined;
        patch.currentRevision = 1;
      }

      await ctx.db.patch(job._id, patch as any);

      // Drain reverse-index rows for this job
      const rows = await ctx.db
        .query("userJobAssignments")
        .withIndex("by_job", (q) => q.eq("jobId", job._id))
        .collect();
      for (const row of rows) {
        await ctx.db.delete(row._id);
        assignmentRowsDeleted++;
      }
    }

    return {
      dryRun,
      cutoff,
      cutoffIso: new Date(cutoff).toISOString(),
      touched,
      resetToScheduled,
      beforeStatusCounts,
      assignmentRowsDeleted,
      samples,
      message:
        (dryRun ? "[DRY RUN] would unassign " : "unassigned ") +
        touched +
        " upcoming jobs (cutoff " +
        new Date(cutoff).toISOString() +
        ")",
    };
  },
});
