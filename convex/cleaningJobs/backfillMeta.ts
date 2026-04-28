import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

/**
 * One-shot internal mutation to backfill `jobSubmissionsMeta` from existing
 * `jobSubmissions` rows. Idempotent — skips submissions that already have a
 * meta row. Paginated via cursor so a large existing table doesn't blow the
 * mutation time/size budget. See
 * Docs/2026-04-28-convex-bandwidth-optimization-plan.md (Wave 2).
 *
 * Run via:
 *   npx convex run cleaningJobs/backfillMeta:run '{}'
 *
 * Returns `{ done, processed, lastCursor }`. Re-invoke with the returned
 * cursor until `done === true`.
 */
export const run = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 50;

    const page = await ctx.db
      .query("jobSubmissions")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    let processed = 0;
    let skipped = 0;
    for (const submission of page.page) {
      const existing = await ctx.db
        .query("jobSubmissionsMeta")
        .withIndex("by_submission", (q) => q.eq("submissionId", submission._id))
        .first();
      if (existing) {
        skipped += 1;
        continue;
      }

      const photoSnapshot = submission.photoSnapshot ?? [];
      const beforeCount = photoSnapshot.filter((p) => p.type === "before").length;
      const afterCount = photoSnapshot.filter((p) => p.type === "after").length;
      const incidentCount = photoSnapshot.filter((p) => p.type === "incident").length;

      await ctx.db.insert("jobSubmissionsMeta", {
        submissionId: submission._id,
        jobId: submission.jobId,
        revision: submission.revision,
        status: submission.status,
        submittedBy: submission.submittedBy,
        submittedAtServer: submission.submittedAtServer,
        submittedAtDevice: submission.submittedAtDevice,
        supersededAt: submission.supersededAt,
        photoCount: photoSnapshot.length,
        beforeCount,
        afterCount,
        incidentCount,
        createdAt: submission.createdAt,
      });
      processed += 1;
    }

    return {
      done: page.isDone,
      processed,
      skipped,
      nextCursor: page.continueCursor,
    };
  },
});
