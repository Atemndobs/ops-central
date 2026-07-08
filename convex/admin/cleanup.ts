import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { mutation, type MutationCtx } from "../_generated/server";
import { onPhotoDeleted } from "../lib/photoStorageAggregate";

async function cascadeDeleteJob(
  ctx: MutationCtx,
  job: Doc<"cleaningJobs">,
): Promise<void> {
  const photos = await ctx.db
    .query("photos")
    .withIndex("by_job", (q) => q.eq("cleaningJobId", job._id))
    .collect();
  for (const photo of photos) {
    await onPhotoDeleted(ctx, photo);
    await ctx.db.delete(photo._id);
  }

  const sessions = await ctx.db
    .query("jobExecutionSessions")
    .withIndex("by_job_and_revision", (q) => q.eq("jobId", job._id))
    .collect();
  for (const session of sessions) {
    await ctx.db.delete(session._id);
  }

  const submissions = await ctx.db
    .query("jobSubmissions")
    .withIndex("by_job", (q) => q.eq("jobId", job._id))
    .collect();
  for (const submission of submissions) {
    await ctx.db.delete(submission._id);
  }

  const audits = await ctx.db
    .query("jobAssignmentAuditEvents")
    .withIndex("by_job", (q) => q.eq("jobId", job._id))
    .collect();
  for (const audit of audits) {
    await ctx.db.delete(audit._id);
  }

  const schedules = await ctx.db
    .query("notificationSchedules")
    .withIndex("by_job", (q) => q.eq("jobId", job._id))
    .collect();
  for (const schedule of schedules) {
    await ctx.db.delete(schedule._id);
  }

  const stockChecks = await ctx.db
    .query("stockChecks")
    .withIndex("by_job", (q) => q.eq("jobId", job._id))
    .collect();
  for (const stockCheck of stockChecks) {
    await ctx.db.delete(stockCheck._id);
  }

  await ctx.db.delete(job._id);
}

export const purgeUnknownPropertyJobs = mutation({
  args: {
    // Optional safety cutoff so we can limit cleanup to older data if needed.
    beforeTs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const cutoff = args.beforeTs ?? Date.now();
    const allJobs = await ctx.db.query("cleaningJobs").collect();
    let deleted = 0;

    for (const job of allJobs) {
      const property = await ctx.db.get(job.propertyId);
      const isOrphan = property === null;
      const isWithinCutoff = (job.scheduledStartAt ?? 0) <= cutoff;

      if (!isOrphan || !isWithinCutoff) {
        continue;
      }

      await cascadeDeleteJob(ctx, job);
      deleted += 1;
    }

    return {
      deleted,
      cutoff,
    };
  },
});

export const purgeOldAndOrphanJobs = mutation({
  args: {},
  handler: async (ctx) => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const cutoff = todayStart.getTime();

    const allJobs = await ctx.db.query("cleaningJobs").collect();
    let deleted = 0;

    for (const job of allJobs) {
      const property = await ctx.db.get(job.propertyId);
      const isPast = (job.scheduledStartAt ?? 0) < cutoff;
      const isOrphan = property === null;

      if (!isPast && !isOrphan) {
        continue;
      }

      await cascadeDeleteJob(ctx, job);
      deleted += 1;
    }

    return { deleted };
  },
});
