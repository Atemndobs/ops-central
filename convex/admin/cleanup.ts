import { mutation } from "../_generated/server";

export const purgeOldAndOrphanJobs = mutation({
  args: {},
  handler: async (ctx) => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const cutoff = todayStart.getTime();

    const allJobs = await ctx.db.query("cleaningJobs").collect();
    let deleted = 0;

    for (const job of allJobs) {
      // Delete if property doesn't exist OR scheduledStartAt is before today
      const property = await ctx.db.get(job.propertyId);
      const isPast = (job.scheduledStartAt ?? 0) < cutoff;
      const isOrphan = property === null;

      if (!isPast && !isOrphan) continue;

      // Cascade: photos
      const photos = await ctx.db.query("photos").withIndex("by_job", (q) => q.eq("cleaningJobId", job._id)).collect();
      for (const p of photos) await ctx.db.delete(p._id);

      // Cascade: execution sessions
      const sessions = await ctx.db.query("jobExecutionSessions").withIndex("by_job_and_revision", (q) => q.eq("jobId", job._id)).collect();
      for (const s of sessions) await ctx.db.delete(s._id);

      // Cascade: submissions
      const submissions = await ctx.db.query("jobSubmissions").withIndex("by_job", (q) => q.eq("jobId", job._id)).collect();
      for (const s of submissions) await ctx.db.delete(s._id);

      // Cascade: audit events
      const audits = await ctx.db.query("jobAssignmentAuditEvents").withIndex("by_job", (q) => q.eq("jobId", job._id)).collect();
      for (const a of audits) await ctx.db.delete(a._id);

      // Cascade: notification schedules
      const notifs = await ctx.db.query("notificationSchedules").withIndex("by_job", (q) => q.eq("jobId", job._id)).collect();
      for (const n of notifs) await ctx.db.delete(n._id);

      // Cascade: stock checks
      const stocks = await ctx.db.query("stockChecks").withIndex("by_job", (q) => q.eq("jobId", job._id)).collect();
      for (const s of stocks) await ctx.db.delete(s._id);

      await ctx.db.delete(job._id);
      deleted++;
    }

    return { deleted };
  },
});
