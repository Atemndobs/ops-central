import { query } from "../_generated/server";
import { requireRole } from "../lib/auth";
import { getCallerJobScopeForListing } from "../lib/companyScope";
import type { Doc, Id } from "../_generated/dataModel";

const openStatuses = ["scheduled", "assigned", "in_progress", "awaiting_approval", "rework_required"] as const;
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

/**
 * Issue #94 (2026-05-19) — these queries previously had:
 *   - NO authentication (anyone with a Convex client could call them).
 *   - NO company-scope (manager from company A could see company B's jobs).
 *
 * Both are fixed below. Auth via requireRole; scope via
 * getCallerJobScopeForListing (same helper cleaningJobs.queries.getAll uses).
 *
 * Stays are scoped via the same propertyScope — a stay belongs to a
 * property, so company access carries through.
 *
 * For managers without an active manager/owner companyMembers row, the
 * scope is an empty Set → all queries return zero-result shapes (empty
 * arrays / zero counts), matching getCleaners / getAll behavior.
 */

type JobLike = Pick<
  Doc<"cleaningJobs">,
  | "propertyId"
  | "status"
  | "scheduledStartAt"
  | "scheduledEndAt"
  | "assignedCleanerIds"
  | "isUrgent"
  | "createdAt"
  | "updatedAt"
> & { _id: Id<"cleaningJobs"> };

function applyPropertyScope<T extends { propertyId: Id<"properties"> }>(
  rows: T[],
  propertyScope: Set<Id<"properties">> | null,
): T[] {
  if (propertyScope === null) return rows;
  return rows.filter((r) => propertyScope.has(r.propertyId));
}

export const getTodayJobs = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireRole(ctx, ["admin", "property_ops", "manager"]);
    const propertyScope = await getCallerJobScopeForListing(ctx, user);
    if (propertyScope !== null && propertyScope.size === 0) return [];

    const { start, end } = getDayRange();

    const jobsRaw = await ctx.db
      .query("cleaningJobs")
      .withIndex("by_scheduled", (q) => q.gte("scheduledStartAt", start))
      .filter((q) => q.lt(q.field("scheduledStartAt"), end))
      .collect();

    const jobs = applyPropertyScope(jobsRaw as JobLike[], propertyScope);

    const activeToday = jobs
      .filter((job) => job.status !== "cancelled")
      .sort((a, b) => a.scheduledStartAt - b.scheduledStartAt);

    const propertyIds = [...new Set(activeToday.map((job) => job.propertyId))];
    const properties = (await Promise.all(
      propertyIds.map((propertyId) => ctx.db.get(propertyId)),
    )) as Array<RelatedEntity | null>;

    const allCleanerIds = [...new Set(activeToday.flatMap((job) => job.assignedCleanerIds ?? []))];
    const cleaners = (await Promise.all(
      allCleanerIds.map((id) => ctx.db.get(id)),
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
      const firstCleanerId = job.assignedCleanerIds?.[0];
      const cleaner = firstCleanerId ? cleanerById.get(firstCleanerId) : null;
      const now = Date.now();

      return {
        id: job._id,
        status: job.status,
        isUrgent:
          job.isUrgent ||
          (isOpenStatus(job.status) &&
            job.scheduledStartAt <= now + 2 * 60 * 60 * 1000),
        scheduledStartAt: job.scheduledStartAt,
        scheduledEndAt: job.scheduledEndAt,
        propertyName: property?.name ?? "Unknown Property",
        cleanerName:
          cleaner?.name ?? cleaner?.email?.split("@")[0] ?? "Unassigned",
      };
    });
  },
});

export const getUpcomingCheckins = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireRole(ctx, ["admin", "property_ops", "manager"]);
    const propertyScope = await getCallerJobScopeForListing(ctx, user);
    if (propertyScope !== null && propertyScope.size === 0) return [];

    const now = Date.now();
    const nextThreeDays = now + 72 * 60 * 60 * 1000;

    const staysRaw = await ctx.db
      .query("stays")
      .withIndex("by_checkin", (q) => q.gte("checkInAt", now))
      .filter((q) => q.lt(q.field("checkInAt"), nextThreeDays))
      .collect();

    const stays = applyPropertyScope(staysRaw, propertyScope);

    const propertyIds = [...new Set(stays.map((stay) => stay.propertyId))];
    const properties = (await Promise.all(
      propertyIds.map((id) => ctx.db.get(id)),
    )) as Array<RelatedEntity | null>;

    const propertyById = new Map(
      properties
        .filter((p): p is RelatedEntity => Boolean(p))
        .map((p) => [p._id, p]),
    );

    return stays
      .sort((a, b) => a.checkInAt - b.checkInAt)
      .slice(0, 8)
      .map((stay) => ({
        id: stay._id,
        propertyId: stay.propertyId,
        propertyName: propertyById.get(stay.propertyId)?.name ?? "Unknown Property",
        checkInAt: stay.checkInAt,
        checkOutAt: stay.checkOutAt,
        guestName: stay.guestName,
      }));
  },
});

export const getQuickStats = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireRole(ctx, ["admin", "property_ops", "manager"]);
    const propertyScope = await getCallerJobScopeForListing(ctx, user);
    if (propertyScope !== null && propertyScope.size === 0) {
      return {
        todayJobs: 0,
        inProgress: 0,
        completedToday: 0,
        needsAttention: 0,
        upcomingCheckins: 0,
        openJobs: 0,
      };
    }

    const { start, end } = getDayRange();

    // NOTE: still a full-table scan. Index-backed pagination is the next
    // optimization once the scope+auth posture is fixed. Acceptable for
    // now because the scope filter trims the result set considerably for
    // managers (typical: a handful of properties).
    const allJobsRaw = await ctx.db.query("cleaningJobs").collect();
    const allJobs = applyPropertyScope(allJobsRaw as JobLike[], propertyScope);

    const todayJobs = allJobs.filter(
      (job) => job.scheduledStartAt >= start && job.scheduledStartAt < end,
    );

    const upcomingStaysRaw = await ctx.db
      .query("stays")
      .withIndex("by_checkin", (q) => q.gte("checkInAt", Date.now()))
      .filter((q) => q.lt(q.field("checkInAt"), end + 24 * 60 * 60 * 1000))
      .collect();
    const upcomingStays = applyPropertyScope(upcomingStaysRaw, propertyScope);

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
          job.status === "rework_required" ||
          job.status === "awaiting_approval" ||
          (job.status === "scheduled" && job.scheduledStartAt < Date.now() - 60 * 60 * 1000),
      ).length,
      upcomingCheckins: upcomingStays.length,
      openJobs: allJobs.filter((job) => isOpenStatus(job.status)).length,
    };
  },
});

export const getRecentActivity = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireRole(ctx, ["admin", "property_ops", "manager"]);
    const propertyScope = await getCallerJobScopeForListing(ctx, user);
    if (propertyScope !== null && propertyScope.size === 0) return [];

    const yesterday = Date.now() - 24 * 60 * 60 * 1000;
    // NOTE: still a full-table scan; same comment as getQuickStats applies.
    const jobsRaw = await ctx.db.query("cleaningJobs").collect();
    const jobs = applyPropertyScope(jobsRaw as JobLike[], propertyScope);

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

    const allCleanerIds = [...new Set(recentJobs.flatMap((job) => job.assignedCleanerIds ?? []))];
    const cleaners = (await Promise.all(
      allCleanerIds.map((id) => ctx.db.get(id)),
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
      awaiting_approval: "Awaiting approval",
      rework_required: "Rework required",
      completed: "Job completed",
      cancelled: "Job cancelled",
    };

    return recentJobs.map((job) => {
      const property = propertyById.get(job.propertyId);
      const firstCleanerId = job.assignedCleanerIds?.[0];
      const cleaner = firstCleanerId ? cleanerById.get(firstCleanerId) : null;

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
