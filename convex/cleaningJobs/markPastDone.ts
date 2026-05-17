/**
 * Bulk-mark past cleaning jobs as completed.
 *
 * Used pre-go-live (2026-05-18) to clear stale scheduled/assigned jobs from
 * Hospitable sync so cleaners only see May 18+ work on day one.
 *
 * Marks any job with scheduledStartAt < cutoff (default: start of "tomorrow"
 * in America/Chicago = property-ops base timezone) and status NOT already in a
 * terminal state (completed, cancelled) as `completed`. Leaves real completions
 * untouched.
 *
 * Usage:
 *   # Dry-run first to see what would change
 *   npx convex run cleaningJobs/markPastDone:markPastDone '{"dryRun": true}'
 *
 *   # Apply with explicit cutoff (ms epoch). Default cutoff is start-of-tomorrow
 *   # in America/Chicago.
 *   npx convex run cleaningJobs/markPastDone:markPastDone '{}'
 *
 *   # Custom cutoff (e.g. start of 2026-05-18 in Chicago = 1747544400000)
 *   npx convex run cleaningJobs/markPastDone:markPastDone '{"cutoffMs": 1747544400000}'
 */
import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

const STATUSES_TO_CLOSE = [
  "scheduled",
  "assigned",
  "in_progress",
  "awaiting_approval",
  "rework_required",
] as const;

// Start of 2026-05-18 00:00 America/Chicago (CDT, UTC-5) in ms epoch.
// 2026-05-18T00:00:00-05:00 = 1747544400000
const DEFAULT_CUTOFF_MS = 1747544400000;

export const markPastDone = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    cutoffMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const cutoff = args.cutoffMs ?? DEFAULT_CUTOFF_MS;
    const dryRun = args.dryRun ?? false;
    const now = Date.now();

    let totalClosed = 0;
    const byStatus: Record<string, number> = {};
    const samples: Array<{
      id: string;
      propertyId: string;
      status: string;
      scheduledStartAt: number;
    }> = [];

    for (const status of STATUSES_TO_CLOSE) {
      const jobs = await ctx.db
        .query("cleaningJobs")
        .withIndex("by_status", (q) => q.eq("status", status))
        .collect();

      for (const job of jobs) {
        if (job.scheduledStartAt >= cutoff) continue;

        byStatus[status] = (byStatus[status] ?? 0) + 1;
        totalClosed++;

        if (samples.length < 10) {
          samples.push({
            id: job._id,
            propertyId: job.propertyId,
            status: job.status,
            scheduledStartAt: job.scheduledStartAt,
          });
        }

        if (dryRun) continue;

        await ctx.db.patch(job._id, {
          status: "completed",
          actualEndAt: job.actualEndAt ?? now,
          completionNotes:
            (job.completionNotes ? job.completionNotes + "\n\n" : "") +
            "[auto-closed pre-go-live 2026-05-18 — was status: " +
            job.status +
            "]",
          updatedAt: now,
        });
      }
    }

    return {
      message:
        (dryRun ? "[DRY RUN] " : "") +
        `Marked ${totalClosed} past jobs as completed (cutoff ${new Date(cutoff).toISOString()})`,
      totalClosed,
      byStatus,
      cutoff,
      dryRun,
      samples,
    };
  },
});
