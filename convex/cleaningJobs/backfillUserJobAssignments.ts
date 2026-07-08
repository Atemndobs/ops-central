import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";

/**
 * One-shot backfill for the `userJobAssignments` reverse-index introduced in
 * Wave 5 (Docs/2026-04-28-convex-bandwidth-optimization-plan.md).
 *
 * Iterates `cleaningJobs`, expands each job's `assignedCleanerIds` array, and
 * inserts a `userJobAssignments` row per (cleaner, job) pair. Idempotent —
 * skips pairs that already have a row in the index.
 *
 * Run via dashboard once after the schema + writes ship:
 *   convex run cleaningJobs/backfillUserJobAssignments:run
 *
 * Optional `cursor` arg lets you resume if the function hits time limits on
 * a very large dataset. With ~150 jobs in opscentral today this is a
 * single-shot run.
 */
export const run = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const pageSize = args.pageSize ?? 200;
    const page = await ctx.db
      .query("cleaningJobs")
      .paginate({ cursor: args.cursor ?? null, numItems: pageSize });

    let inserted = 0;
    let alreadyPresent = 0;

    for (const job of page.page as Doc<"cleaningJobs">[]) {
      for (const cleanerId of job.assignedCleanerIds) {
        const existing = await ctx.db
          .query("userJobAssignments")
          .withIndex("by_user_and_job", (q) =>
            q.eq("userId", cleanerId).eq("jobId", job._id),
          )
          .first();
        if (existing) {
          alreadyPresent += 1;
          continue;
        }
        await ctx.db.insert("userJobAssignments", {
          userId: cleanerId,
          jobId: job._id,
          createdAt: job.createdAt ?? Date.now(),
        });
        inserted += 1;
      }
    }

    return {
      inserted,
      alreadyPresent,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});
