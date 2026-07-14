import { query } from "../_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { getCurrentUser } from "../lib/auth";
import {
  canCallerAccessPropertyById,
  getCallerJobScopeForListing,
} from "../lib/companyScope";

type PropertyStatus = "ready" | "dirty" | "in_progress" | "vacant";

const JOB_LOOKBACK_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
// Generous upper bound on a single reservation's length — bounds the historical
// lookback when reading a property's current/upcoming stays via `by_property_dates`.
const MAX_STAY_MS = 180 * 24 * 60 * 60 * 1000;
// Per-property read ceiling for the readiness enrichment. A property has only a
// handful of upcoming stays / recent jobs, so this stays tiny while never
// missing the next-stay / active-job selection.
const PER_PROPERTY_SCAN_CAP = 50;

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
  const relevantStayFloor = now - MAX_STAY_MS;
  const jobFloor = now - JOB_LOOKBACK_WINDOW_MS;

  // Per-property bounded index reads. The previous implementation scanned up to
  // 10k rows of BOTH `stays` and `cleaningJobs` on every call (effectively the
  // whole tables at this app's scale) and, by subscribing to those entire index
  // ranges, re-executed on every job/stay write across ALL properties. This
  // query is mounted on ~10 always-open pages, which made it the single biggest
  // read-cost driver (~2.6 GB/mo). Reading each property's OWN recent stays/jobs
  // via `by_property_dates` / `by_property_and_scheduled` bounds the read to a
  // handful of rows per property and narrows the reactive footprint to that
  // property's rows.
  const perProperty = await Promise.all(
    properties.map(async (property) => {
      const [stays, jobs] = await Promise.all([
        ctx.db
          .query("stays")
          .withIndex("by_property_dates", (q) =>
            q.eq("propertyId", property._id).gte("checkInAt", relevantStayFloor),
          )
          .take(PER_PROPERTY_SCAN_CAP),
        ctx.db
          .query("cleaningJobs")
          .withIndex("by_property_and_scheduled", (q) =>
            q.eq("propertyId", property._id).gte("scheduledStartAt", jobFloor),
          )
          .take(PER_PROPERTY_SCAN_CAP),
      ]);
      return { propertyId: property._id, stays, jobs };
    }),
  );

  const nextStayByProperty = new Map<Id<"properties">, Doc<"stays">>();
  const activeJobByProperty = new Map<Id<"properties">, Doc<"cleaningJobs">>();
  for (const { propertyId, stays, jobs } of perProperty) {
    for (const stay of stays) {
      // Match the old `by_checkout >= now` candidate filter: only stays that
      // have not yet departed count toward "next stay".
      if (stay.checkOutAt < now) {
        continue;
      }
      const current = nextStayByProperty.get(propertyId);
      if (!current || shouldReplaceSelectedStay(current, stay)) {
        nextStayByProperty.set(propertyId, stay);
      }
    }
    for (const job of jobs) {
      if (!isTrackedJobStatus(job.status)) {
        continue;
      }
      const current = activeJobByProperty.get(propertyId);
      if (!current || shouldReplaceSelectedJob(current, job)) {
        activeJobByProperty.set(propertyId, job);
      }
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
    const user = await getCurrentUser(ctx);
    const includeInactive = args.includeInactive ?? false;

    // Manager-scope task (2026-05-17): admin/ops see all; managers see
    // only their company's properties; cleaners use
    // getMyAccessibleProperties and get [] here.
    const allowedPropertyIds = await getCallerJobScopeForListing(ctx, user);
    if (allowedPropertyIds && allowedPropertyIds.size === 0) {
      return [];
    }

    let properties;
    if (!includeInactive) {
      properties = await ctx.db
        .query("properties")
        .withIndex("by_active", (q) => q.eq("isActive", true))
        .collect();
    } else {
      properties = await ctx.db.query("properties").collect();
    }

    if (allowedPropertyIds) {
      properties = properties.filter((p) => allowedPropertyIds.has(p._id));
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
    const user = await getCurrentUser(ctx);
    const property = await ctx.db.get(args.id);

    if (!property || !property.isActive) {
      return null;
    }

    // Direct-ID access guard (manager-scope task, 2026-05-17).
    // - admin / property_ops: unrestricted.
    // - manager: only if the property is currently assigned to the
    //   manager's company via companyProperties.
    // - cleaner: only if assigned to at least one cleaningJob for this
    //   property. Mirrors `getMyAccessibleProperties`.
    if (user.role === "manager") {
      const allowed = await canCallerAccessPropertyById(ctx, user, args.id);
      if (!allowed) {
        return null;
      }
    } else if (user.role === "cleaner") {
      const assignments = await ctx.db
        .query("userJobAssignments")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();
      const hasJobForProperty = (
        await Promise.all(
          assignments.map(async (row) => {
            const job = await ctx.db.get(row.jobId);
            return job?.propertyId === args.id;
          }),
        )
      ).some(Boolean);
      if (!hasJobForProperty) {
        return null;
      }
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
    const user = await getCurrentUser(ctx);
    const includeInactive = args.includeInactive ?? false;
    const queryText = args.query.trim().toLowerCase();
    const limit = args.limit ?? 50;
    const cap = Math.max(1, Math.min(limit, 100));

    const allowedPropertyIds = await getCallerJobScopeForListing(ctx, user);
    if (allowedPropertyIds && allowedPropertyIds.size === 0) {
      return [];
    }
    const applyScope = (list: Doc<"properties">[]) =>
      allowedPropertyIds
        ? list.filter((p) => allowedPropertyIds.has(p._id))
        : list;

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
      const sorted = applyScope(properties)
        .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))
        .slice(0, cap);
      return await enrichProperties(ctx, sorted);
    }

    // search_name has no filterFields, so filter isActive in memory.
    // Fetch more candidates when scoping so the final scope+active filter
    // doesn't underflow `cap` on managers whose company has few properties.
    const overscan = allowedPropertyIds ? cap * 4 : cap * 2;
    const results = await ctx.db
      .query("properties")
      .withSearchIndex("search_name", (q) => q.search("name", queryText))
      .take(overscan);

    const activeFiltered = includeInactive
      ? results
      : results.filter((property) => property.isActive);
    const scoped = applyScope(activeFiltered);

    return await enrichProperties(ctx, scoped.slice(0, cap));
  },
});

export const getAll = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const limit = args.limit ?? 500;

    const allowedPropertyIds = await getCallerJobScopeForListing(ctx, user);
    if (allowedPropertyIds && allowedPropertyIds.size === 0) {
      return [];
    }

    let properties = await ctx.db
      .query("properties")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .collect();

    if (allowedPropertyIds) {
      properties = properties.filter((p) => allowedPropertyIds.has(p._id));
    }

    const sorted = properties
      .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))
      .slice(0, limit);
    return await enrichProperties(ctx, sorted);
  },
});

/**
 * Returns properties the current user can access.
 *
 * - Admin / property_ops: all active properties.
 * - Manager: only active properties currently assigned to the manager's
 *   company via `companyProperties`. Fail-closed if the manager has no
 *   active manager/owner membership.
 * - Cleaner / any other role: only properties the user has been assigned
 *   to on at least one cleaning job (past or upcoming). Derived from
 *   `userJobAssignments`, mirroring how jobs are scoped in
 *   `cleaningJobs.getMyAssigned`.
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

    // Manager-scope task (2026-05-17): managers were previously lumped
    // with admin/ops and got every active property. They should only get
    // their company's `companyProperties`.
    const allowedPropertyIds = await getCallerJobScopeForListing(ctx, user);
    const isUnscoped = allowedPropertyIds === null;

    const activeProperties = await ctx.db
      .query("properties")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .collect();

    let filtered: Doc<"properties">[];
    if (isUnscoped) {
      // admin / property_ops
      filtered = activeProperties;
    } else if (user.role === "manager") {
      filtered = activeProperties.filter((p) => allowedPropertyIds.has(p._id));
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
