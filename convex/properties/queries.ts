import { query } from "../_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { getCurrentUser } from "../lib/auth";

type PropertyStatus = "ready" | "dirty" | "in_progress" | "vacant";

const JOB_SCAN_LIMIT_MIN = 2000;
const JOB_SCAN_LIMIT_MAX = 10000;
const STAY_SCAN_LIMIT_MIN = 2000;
const STAY_SCAN_LIMIT_MAX = 10000;
const JOB_LOOKBACK_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

const ACTIVE_JOB_STATUS_PRIORITY: Record<
  Extract<Doc<"cleaningJobs">["status"], "in_progress" | "awaiting_approval" | "rework_required" | "assigned" | "scheduled">,
  number
> = {
  in_progress: 0,
  awaiting_approval: 1,
  rework_required: 2,
  assigned: 3,
  scheduled: 4,
};

function calcScanLimit(
  propertyCount: number,
  multiplier: number,
  min: number,
  max: number,
): number {
  return Math.max(min, Math.min(max, propertyCount * multiplier));
}

function isTrackedJobStatus(
  status: Doc<"cleaningJobs">["status"],
): status is keyof typeof ACTIVE_JOB_STATUS_PRIORITY {
  return status in ACTIVE_JOB_STATUS_PRIORITY;
}

function shouldReplaceSelectedJob(
  current: Doc<"cleaningJobs">,
  candidate: Doc<"cleaningJobs">,
): boolean {
  const currentPriority = ACTIVE_JOB_STATUS_PRIORITY[current.status as keyof typeof ACTIVE_JOB_STATUS_PRIORITY];
  const candidatePriority =
    ACTIVE_JOB_STATUS_PRIORITY[candidate.status as keyof typeof ACTIVE_JOB_STATUS_PRIORITY];
  if (candidatePriority < currentPriority) {
    return true;
  }
  if (candidatePriority > currentPriority) {
    return false;
  }
  return candidate.scheduledStartAt < current.scheduledStartAt;
}

function shouldReplaceSelectedStay(current: Doc<"stays">, candidate: Doc<"stays">): boolean {
  if (candidate.checkInAt < current.checkInAt) {
    return true;
  }
  if (candidate.checkInAt > current.checkInAt) {
    return false;
  }
  return candidate.checkOutAt < current.checkOutAt;
}

function derivePropertyStatus(
  jobStatus: Doc<"cleaningJobs">["status"] | undefined,
  hasUpcomingOrCurrentStay: boolean,
): PropertyStatus {
  if (jobStatus === "in_progress" || jobStatus === "awaiting_approval") {
    return "in_progress";
  }
  if (
    jobStatus === "rework_required" ||
    jobStatus === "assigned" ||
    jobStatus === "scheduled"
  ) {
    return "dirty";
  }
  if (hasUpcomingOrCurrentStay) {
    return "ready";
  }
  return "vacant";
}

async function enrichProperties(ctx: QueryCtx, properties: Doc<"properties">[]) {
  if (properties.length === 0) {
    return [];
  }

  const now = Date.now();
  const propertyIds = new Set<Id<"properties">>(properties.map((property) => property._id));
  const stayScanLimit = calcScanLimit(
    propertyIds.size,
    20,
    STAY_SCAN_LIMIT_MIN,
    STAY_SCAN_LIMIT_MAX,
  );
  const jobScanLimit = calcScanLimit(
    propertyIds.size,
    25,
    JOB_SCAN_LIMIT_MIN,
    JOB_SCAN_LIMIT_MAX,
  );

  const [candidateStays, candidateJobs] = await Promise.all([
    ctx.db
      .query("stays")
      .withIndex("by_checkout", (q) => q.gte("checkOutAt", now))
      .take(stayScanLimit),
    ctx.db
      .query("cleaningJobs")
      .withIndex("by_scheduled", (q) => q.gte("scheduledStartAt", now - JOB_LOOKBACK_WINDOW_MS))
      .take(jobScanLimit),
  ]);

  const nextStayByProperty = new Map<Id<"properties">, Doc<"stays">>();
  for (const stay of candidateStays) {
    if (!propertyIds.has(stay.propertyId)) {
      continue;
    }
    const current = nextStayByProperty.get(stay.propertyId);
    if (!current || shouldReplaceSelectedStay(current, stay)) {
      nextStayByProperty.set(stay.propertyId, stay);
    }
  }

  const activeJobByProperty = new Map<Id<"properties">, Doc<"cleaningJobs">>();
  for (const job of candidateJobs) {
    if (!propertyIds.has(job.propertyId) || !isTrackedJobStatus(job.status)) {
      continue;
    }

    const current = activeJobByProperty.get(job.propertyId);
    if (!current || shouldReplaceSelectedJob(current, job)) {
      activeJobByProperty.set(job.propertyId, job);
    }
  }

  const cleanerIds = new Set<Id<"users">>();
  for (const job of activeJobByProperty.values()) {
    const firstCleanerId = job.assignedCleanerIds[0];
    if (firstCleanerId) {
      cleanerIds.add(firstCleanerId);
    }
  }

  const cleaners = await Promise.all([...cleanerIds].map((id) => ctx.db.get(id)));
  const cleanerNameById = new Map(
    cleaners
      .filter((cleaner): cleaner is NonNullable<typeof cleaner> => cleaner !== null)
      .map((cleaner) => [cleaner._id, cleaner.name ?? cleaner.email] as const),
  );

  return properties.map((property) => {
    const nextStay = nextStayByProperty.get(property._id);
    const activeJob = activeJobByProperty.get(property._id);
    const assignedCleanerId = activeJob?.assignedCleanerIds[0];
    const assignedCleanerName = assignedCleanerId
      ? cleanerNameById.get(assignedCleanerId)
      : undefined;

    return {
      ...property,
      status: derivePropertyStatus(activeJob?.status, Boolean(nextStay)),
      nextCheckInAt: nextStay?.checkInAt,
      nextCheckOutAt: nextStay?.checkOutAt,
      assignedCleanerName,
      primaryPhotoUrl: property.imageUrl,
      postalCode: property.zipCode,
    };
  });
}

export const list = query({
  args: {
    includeInactive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const includeInactive = args.includeInactive ?? false;

    let properties;
    if (!includeInactive) {
      properties = await ctx.db
        .query("properties")
        .withIndex("by_active", (q) => q.eq("isActive", true))
        .collect();
    } else {
      properties = await ctx.db.query("properties").collect();
    }

    const sorted = properties.sort(
      (a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt),
    );
    return await enrichProperties(ctx, sorted);
  },
});

export const getById = query({
  args: {
    id: v.id("properties"),
  },
  handler: async (ctx, args) => {
    const property = await ctx.db.get(args.id);

    if (!property || !property.isActive) {
      return null;
    }

    const [enriched] = await enrichProperties(ctx, [property]);
    return enriched ?? null;
  },
});

export const search = query({
  args: {
    query: v.string(),
    includeInactive: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const includeInactive = args.includeInactive ?? false;
    const queryText = args.query.trim().toLowerCase();
    const limit = args.limit ?? 50;
    const cap = Math.max(1, Math.min(limit, 100));

    if (!queryText) {
      let properties;
      if (!includeInactive) {
        properties = await ctx.db
          .query("properties")
          .withIndex("by_active", (q) => q.eq("isActive", true))
          .collect();
      } else {
        properties = await ctx.db.query("properties").collect();
      }
      const sorted = properties
        .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))
        .slice(0, cap);
      return await enrichProperties(ctx, sorted);
    }

    // search_name has no filterFields, so filter isActive in memory
    const results = await ctx.db
      .query("properties")
      .withSearchIndex("search_name", (q) => q.search("name", queryText))
      .take(cap * 2); // fetch extra to account for in-memory filtering

    const filtered = includeInactive
      ? results
      : results.filter((property) => property.isActive);

    return await enrichProperties(ctx, filtered.slice(0, cap));
  },
});

export const getAll = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 500;

    const properties = await ctx.db
      .query("properties")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .collect();

    const sorted = properties
      .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))
      .slice(0, limit);
    return await enrichProperties(ctx, sorted);
  },
});

/**
 * Returns properties the current user can access.
 *
 * - Admin / property_ops / manager: all active properties (same as getAll).
 * - Cleaner / any other role: only properties the user has been assigned to
 *   on at least one cleaning job (past or upcoming). Derived from
 *   cleaningJobs.assignedCleanerIds, mirroring how jobs are scoped in
 *   cleaningJobs.getMyAssigned.
 *
 * This is the canonical query for any cleaner-facing property picker
 * (incident reports, standalone reports, etc.) so cleaners only see the
 * properties they legitimately have context on.
 */
export const getMyAccessibleProperties = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const limit = args.limit ?? 500;

    const isPrivileged =
      user.role === "admin" ||
      user.role === "property_ops" ||
      user.role === "manager";

    const activeProperties = await ctx.db
      .query("properties")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .collect();

    let filtered: Doc<"properties">[];
    if (isPrivileged) {
      filtered = activeProperties;
    } else {
      // Bandwidth: previously did `ctx.db.query("cleaningJobs").collect()` to
      // find this cleaner's assigned properties — a full scan of the jobs
      // table on every cleaner subscription tick. Wave 6 — read from the
      // `userJobAssignments` reverse-index (introduced in Wave 5.a) and only
      // fetch the matching jobs. See
      // Docs/2026-04-28-convex-bandwidth-optimization-plan.md.
      //
      // Pre-requisite: `cleaningJobs/backfillUserJobAssignments:run` must
      // have populated assignment rows on the target deployment. Verified
      // on whimsical-narwhal-849. On usable-anaconda-394 the deployment is
      // paused and cleaners can't connect; backfill runs at consolidation.
      const assignments = await ctx.db
        .query("userJobAssignments")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();
      const assignedJobs = await Promise.all(
        assignments.map((row) => ctx.db.get(row.jobId)),
      );
      const assignedPropertyIds = new Set<Id<"properties">>();
      for (const job of assignedJobs) {
        if (job) {
          assignedPropertyIds.add(job.propertyId);
        }
      }
      filtered = activeProperties.filter((p) => assignedPropertyIds.has(p._id));
    }

    const sorted = filtered
      .sort(
        (a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt),
      )
      .slice(0, limit);
    return await enrichProperties(ctx, sorted);
  },
});
