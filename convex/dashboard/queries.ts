import { queryGeneric } from "convex/server";

type JobStatus =
  | "scheduled"
  | "assigned"
  | "in_progress"
  | "awaiting_approval"
  | "rework_required"
  | "completed"
  | "cancelled";

const activeStatuses: JobStatus[] = [
  "scheduled",
  "assigned",
  "in_progress",
  "awaiting_approval",
  "rework_required",
];

const getDayRange = (date = new Date()) => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.getTime(), end: end.getTime() };
};

export const getTodayJobs = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const { start, end } = getDayRange();

    const jobs = await ctx.db
      .query("cleaningJobs")
      .withIndex("by_scheduled", (q) => q.gte("scheduledStartAt", start))
      .filter((q) => q.lt(q.field("scheduledStartAt"), end))
      .collect();

    const sorted = jobs
      .filter((job) => job.status !== "cancelled")
      .sort((a, b) => a.scheduledStartAt - b.scheduledStartAt);

    return Promise.all(
      sorted.map(async (job) => {
        const property = await ctx.db.get(job.propertyId);
        const cleanerId = job.assignedCleanerIds?.[0];
        const cleaner = cleanerId ? await ctx.db.get(cleanerId) : null;

        return {
          id: job._id,
          status: job.status,
          isUrgent: job.isUrgent,
          scheduledStartAt: job.scheduledStartAt,
          scheduledEndAt: job.scheduledEndAt,
          propertyName: property?.name ?? "Unknown Property",
          cleanerName:
            cleaner?.name ?? cleaner?.email?.split("@")[0] ?? "Unassigned",
        };
      }),
    );
  },
});

export const getUpcomingCheckins = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const nextThreeDays = now + 72 * 60 * 60 * 1000;

    const stays = await ctx.db
      .query("stays")
      .withIndex("by_checkin", (q) => q.gte("checkInAt", now))
      .filter((q) => q.lt(q.field("checkInAt"), nextThreeDays))
      .collect();

    const upcoming = stays
      .sort((a, b) => a.checkInAt - b.checkInAt)
      .slice(0, 8);

    return Promise.all(
      upcoming.map(async (stay) => {
        const property = await ctx.db.get(stay.propertyId);
        return {
          id: stay._id,
          propertyId: stay.propertyId,
          propertyName: property?.name ?? "Unknown Property",
          checkInAt: stay.checkInAt,
          checkOutAt: stay.checkOutAt,
          guestName: stay.guestName ?? "Guest",
        };
      }),
    );
  },
});

export const getQuickStats = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const { start, end } = getDayRange();

    const jobs = await ctx.db.query("cleaningJobs").collect();
    const todaysJobs = jobs.filter(
      (job) => job.scheduledStartAt >= start && job.scheduledStartAt < end,
    );

    const upcomingCheckins = await ctx.db
      .query("stays")
      .withIndex("by_checkin", (q) => q.gte("checkInAt", now))
      .filter((q) => q.lt(q.field("checkInAt"), end + 24 * 60 * 60 * 1000))
      .collect();

    const readyProperties = todaysJobs.filter(
      (job) => job.status === "completed",
    ).length;
    const inProgressProperties = todaysJobs.filter(
      (job) =>
        job.status === "scheduled" ||
        job.status === "assigned" ||
        job.status === "in_progress",
    ).length;
    const attentionProperties = todaysJobs.filter(
      (job) =>
        job.status === "awaiting_approval" ||
        job.status === "rework_required" ||
        job.opsRiskFlag ||
        job.partyRiskFlag ||
        job.isUrgent,
    ).length;

    return {
      todayJobs: todaysJobs.length,
      inProgress: jobs.filter((job) => job.status === "in_progress").length,
      completedToday: jobs.filter(
        (job) =>
          job.status === "completed" &&
          job.actualEndAt !== undefined &&
          job.actualEndAt >= start &&
          job.actualEndAt < end,
      ).length,
      needsAttention: jobs.filter(
        (job) =>
          job.status === "rework_required" ||
          job.status === "awaiting_approval" ||
          job.isUrgent,
      ).length,
      upcomingCheckins: upcomingCheckins.length,
      readiness: {
        ready: readyProperties,
        inProgress: inProgressProperties,
        attention: attentionProperties,
      },
      openJobs: jobs.filter((job) => activeStatuses.includes(job.status)).length,
    };
  },
});

export const getRecentActivity = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const yesterday = Date.now() - 24 * 60 * 60 * 1000;
    const jobs = await ctx.db.query("cleaningJobs").collect();

    const recentJobs = jobs
      .filter((job) => (job.updatedAt ?? job.createdAt) >= yesterday)
      .sort(
        (a, b) =>
          (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt),
      )
      .slice(0, 12);

    return Promise.all(
      recentJobs.map(async (job) => {
        const property = await ctx.db.get(job.propertyId);
        const cleanerId = job.assignedCleanerIds?.[0];
        const cleaner = cleanerId ? await ctx.db.get(cleanerId) : null;

        const actionByStatus: Record<JobStatus, string> = {
          scheduled: "Job scheduled",
          assigned: "Cleaner assigned",
          in_progress: "Job started",
          awaiting_approval: "Awaiting approval",
          rework_required: "Rework required",
          completed: "Job completed",
          cancelled: "Job cancelled",
        };

        const status = job.status as JobStatus;

        return {
          id: job._id,
          jobId: job._id,
          status,
          action: actionByStatus[status] ?? "Status updated",
          propertyName: property?.name ?? "Unknown Property",
          cleanerName:
            cleaner?.name ?? cleaner?.email?.split("@")[0] ?? "Unassigned",
          timestamp: job.updatedAt ?? job.createdAt,
        };
      }),
    );
  },
});
