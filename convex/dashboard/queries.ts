import { queryGeneric } from "convex/server";

const openStatuses = ["scheduled", "assigned", "in_progress"] as const;
type OpenStatus = (typeof openStatuses)[number];

type RelatedEntity = {
  _id: string;
  name?: string;
  email?: string;
  estimatedCleaningMinutes?: number;
};

const getDayRange = (date = new Date()) => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.getTime(), end: end.getTime() };
};

function isOpenStatus(status: string): status is OpenStatus {
  return openStatuses.includes(status as OpenStatus);
}

export const getTodayJobs = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const { start, end } = getDayRange();

    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_scheduled", (q) => q.gte("scheduledFor", start))
      .filter((q) => q.lt(q.field("scheduledFor"), end))
      .collect();

    const activeToday = jobs
      .filter((job) => job.status !== "cancelled")
      .sort((a, b) => a.scheduledFor - b.scheduledFor);

    const propertyIds = [...new Set(activeToday.map((job) => job.propertyId))];
    const properties = (await Promise.all(
      propertyIds.map((propertyId) => ctx.db.get(propertyId)),
    )) as Array<RelatedEntity | null>;
    const cleaners = (await Promise.all(
      activeToday.map((job) => (job.cleanerId ? ctx.db.get(job.cleanerId) : null)),
    )) as Array<RelatedEntity | null>;

    const propertyById = new Map(
      properties
        .filter((property): property is RelatedEntity => Boolean(property))
        .map((property) => [property._id, property]),
    );
    const cleanerById = new Map(
      cleaners
        .filter((cleaner): cleaner is RelatedEntity => Boolean(cleaner))
        .map((cleaner) => [cleaner._id, cleaner]),
    );

    return activeToday.map((job) => {
      const property = propertyById.get(job.propertyId);
      const cleaner = job.cleanerId ? cleanerById.get(job.cleanerId) : null;
      const estimatedDurationMs = (property?.estimatedCleaningMinutes ?? 120) * 60 * 1000;
      const now = Date.now();

      return {
        id: job._id,
        status: job.status,
        isUrgent:
          isOpenStatus(job.status) &&
          job.scheduledFor <= now + 2 * 60 * 60 * 1000,
        scheduledStartAt: job.scheduledFor,
        scheduledEndAt: job.scheduledFor + estimatedDurationMs,
        propertyName: property?.name ?? "Unknown Property",
        cleanerName:
          cleaner?.name ?? cleaner?.email?.split("@")[0] ?? "Unassigned",
      };
    });
  },
});

export const getUpcomingCheckins = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const nextThreeDays = now + 72 * 60 * 60 * 1000;

    const properties = await ctx.db
      .query("properties")
      .withIndex("by_isActive", (q) => q.eq("isActive", true))
      .collect();

    return properties
      .filter(
        (property) =>
          property.nextCheckInAt !== undefined &&
          property.nextCheckInAt >= now &&
          property.nextCheckInAt < nextThreeDays,
      )
      .sort((a, b) => (a.nextCheckInAt ?? 0) - (b.nextCheckInAt ?? 0))
      .slice(0, 8)
      .map((property) => ({
        id: property._id,
        propertyId: property._id,
        propertyName: property.name,
        checkInAt: property.nextCheckInAt!,
        checkOutAt: property.nextCheckOutAt ?? property.nextCheckInAt!,
        guestName: "Upcoming guest",
      }));
  },
});

export const getQuickStats = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const { start, end } = getDayRange();

    const allJobs = await ctx.db.query("jobs").collect();
    const todayJobs = allJobs.filter(
      (job) => job.scheduledFor >= start && job.scheduledFor < end,
    );

    const activeProperties = await ctx.db
      .query("properties")
      .withIndex("by_isActive", (q) => q.eq("isActive", true))
      .collect();

    const upcomingCheckins = activeProperties.filter(
      (property) =>
        property.nextCheckInAt !== undefined &&
        property.nextCheckInAt >= Date.now() &&
        property.nextCheckInAt < end + 24 * 60 * 60 * 1000,
    );

    return {
      todayJobs: todayJobs.length,
      inProgress: allJobs.filter((job) => job.status === "in_progress").length,
      completedToday: allJobs.filter(
        (job) =>
          job.status === "completed" &&
          (job.updatedAt ?? job.createdAt) >= start &&
          (job.updatedAt ?? job.createdAt) < end,
      ).length,
      needsAttention: allJobs.filter(
        (job) =>
          job.status === "cancelled" ||
          (job.status === "scheduled" && job.scheduledFor < Date.now() - 60 * 60 * 1000),
      ).length,
      upcomingCheckins: upcomingCheckins.length,
      readiness: {
        ready: activeProperties.filter((property) => property.status === "ready").length,
        inProgress: activeProperties.filter((property) => property.status === "in_progress")
          .length,
        attention: activeProperties.filter((property) => property.status === "dirty").length,
      },
      openJobs: allJobs.filter((job) => isOpenStatus(job.status)).length,
    };
  },
});

export const getRecentActivity = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const yesterday = Date.now() - 24 * 60 * 60 * 1000;
    const jobs = await ctx.db.query("jobs").collect();

    const recentJobs = jobs
      .filter((job) => (job.updatedAt ?? job.createdAt) >= yesterday)
      .sort(
        (a, b) =>
          (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt),
      )
      .slice(0, 12);

    const propertyIds = [...new Set(recentJobs.map((job) => job.propertyId))];
    const properties = (await Promise.all(
      propertyIds.map((propertyId) => ctx.db.get(propertyId)),
    )) as Array<RelatedEntity | null>;
    const cleaners = (await Promise.all(
      recentJobs.map((job) => (job.cleanerId ? ctx.db.get(job.cleanerId) : null)),
    )) as Array<RelatedEntity | null>;

    const propertyById = new Map(
      properties
        .filter((property): property is RelatedEntity => Boolean(property))
        .map((property) => [property._id, property]),
    );
    const cleanerById = new Map(
      cleaners
        .filter((cleaner): cleaner is RelatedEntity => Boolean(cleaner))
        .map((cleaner) => [cleaner._id, cleaner]),
    );

    const actionByStatus: Record<string, string> = {
      scheduled: "Job scheduled",
      assigned: "Cleaner assigned",
      in_progress: "Job started",
      completed: "Job completed",
      approved: "Job approved",
      cancelled: "Job cancelled",
    };

    return recentJobs.map((job) => {
      const property = propertyById.get(job.propertyId);
      const cleaner = job.cleanerId ? cleanerById.get(job.cleanerId) : null;

      return {
        id: job._id,
        jobId: job._id,
        status: job.status,
        action: actionByStatus[job.status] ?? "Status updated",
        propertyName: property?.name ?? "Unknown Property",
        cleanerName:
          cleaner?.name ?? cleaner?.email?.split("@")[0] ?? "Unassigned",
        timestamp: job.updatedAt ?? job.createdAt,
      };
    });
  },
});
