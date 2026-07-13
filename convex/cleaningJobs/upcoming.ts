import { internalMutation } from "../_generated/server";
import {
  createNotificationsForUsers,
  createOpsNotifications,
} from "../lib/opsNotifications";

const WINDOW_MIN_MS = 25 * 60 * 1000; // 25 min ahead
const WINDOW_MAX_MS = 35 * 60 * 1000; // 35 min ahead (cron runs every 5 min)

export const sendUpcomingJobNotifications = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const windowStart = now + WINDOW_MIN_MS;
    const windowEnd = now + WINDOW_MAX_MS;

    const jobs = await ctx.db
      .query("cleaningJobs")
      .withIndex("by_scheduled", (q) =>
        q.gte("scheduledStartAt", windowStart).lte("scheduledStartAt", windowEnd),
      )
      .collect();

    const eligible = jobs.filter(
      (job) =>
        (job.status === "scheduled" || job.status === "assigned") &&
        job.upcomingNotifiedAt === undefined,
    );

    for (const job of eligible) {
      const property = await ctx.db.get(job.propertyId);
      const propertyName = property?.name ?? "Your property";
      const minutesAway = Math.round((job.scheduledStartAt - now) / 60_000);

      // Notify cleaners assigned to the job
      if (job.assignedCleanerIds && job.assignedCleanerIds.length > 0) {
        await createNotificationsForUsers(ctx, {
          userIds: job.assignedCleanerIds,
          type: "job_upcoming",
          title: "Job Starting Soon",
          message: `${propertyName} starts in ~${minutesAway} minutes.`,
          messageKey: "notifications.messages.job_upcoming_cleaner",
          messageParams: { propertyName, minutes: minutesAway },
          data: { jobId: job._id, propertyId: job.propertyId },
        });
      }

      // Notify ops team
      await createOpsNotifications(ctx, {
        type: "job_upcoming",
        title: "Job Starting Soon",
        message: `${propertyName} starts in ~${minutesAway} minutes.`,
        messageKey: "notifications.messages.job_upcoming_ops",
        messageParams: { propertyName, minutes: minutesAway },
        data: { jobId: job._id, propertyId: job.propertyId },
      });

      // Mark as notified to prevent duplicate alerts
      await ctx.db.patch(job._id, { upcomingNotifiedAt: now });
    }

    return { notified: eligible.length };
  },
});
