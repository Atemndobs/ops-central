/**
 * Admin Queries for J&A Business Solutions
 *
 * Provides admin-level queries for user management, dashboard statistics,
 * company management, and various tool metrics.
 *
 * Converted from:
 * - /api/admin/users
 * - /api/admin/users/[id]
 * - /api/admin/cleaners/companies
 * - /api/admin/metrics
 */

import { v } from "convex/values";
import { query, type QueryCtx } from "../_generated/server";
import { type Doc, type Id } from "../_generated/dataModel";
import { requireRole, requireAuth } from "../lib/auth";
import { groupActiveByUser } from "../lib/ownership";

type TeamAvailability = "working" | "available" | "off";

const WORKING_STATUSES = new Set<Doc<"cleaningJobs">["status"]>([
  "in_progress",
  "awaiting_approval",
]);
const UPCOMING_STATUSES = new Set<Doc<"cleaningJobs">["status"]>([
  "scheduled",
  "assigned",
]);
const ACTIVE_ASSIGNMENT_STATUSES = new Set<Doc<"cleaningJobs">["status"]>([
  "scheduled",
  "assigned",
  "in_progress",
  "awaiting_approval",
]);
/**
 * Slack between a job's `scheduledStartAt` (indexed) and its `metricTimestamp`
 * (completion time — not indexed). Used to bound getTeamMetrics' job read while
 * keeping the exact in-memory `isWithinLookback` filter authoritative. Generous
 * on purpose: a job completed/approved more than this long after it was
 * scheduled would be excluded from the lookback metrics, which does not happen
 * in practice (and if such a job is still open, it arrives via the by_status read).
 */
const METRIC_SCHEDULE_BUFFER_MS = 60 * 24 * 60 * 60 * 1000;
const QUALITY_RATED_STATUSES = new Set<Doc<"cleaningJobs">["status"]>([
  "completed",
  "awaiting_approval",
  "rework_required",
  "cancelled",
]);
const QUALITY_POSITIVE_STATUSES = new Set<Doc<"cleaningJobs">["status"]>([
  "completed",
  "awaiting_approval",
]);

function normalizeName(user: { name?: string; email?: string }): string {
  return (user.name?.trim() || user.email || "").toLowerCase();
}

function metricTimestamp(job: Doc<"cleaningJobs">): number {
  return (
    job.actualEndAt ??
    job.approvedAt ??
    job.rejectedAt ??
    job.scheduledEndAt ??
    job.scheduledStartAt
  );
}

function isWithinLookback(job: Doc<"cleaningJobs">, lookbackStart: number): boolean {
  return metricTimestamp(job) >= lookbackStart;
}

function pickAvailability(
  jobs: Doc<"cleaningJobs">[],
  now: number,
  horizonEnd: number,
): TeamAvailability {
  const hasWorking = jobs.some((job) => WORKING_STATUSES.has(job.status));
  if (hasWorking) {
    return "working";
  }

  const hasUpcoming = jobs.some(
    (job) =>
      UPCOMING_STATUSES.has(job.status) &&
      job.scheduledStartAt >= now &&
      job.scheduledStartAt <= horizonEnd,
  );
  if (hasUpcoming) {
    return "available";
  }

  return "off";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isActiveCompanyPropertyAssignment(
  assignment: Doc<"companyProperties">,
): boolean {
  return assignment.isActive !== false && assignment.unassignedAt === undefined;
}

// ═══════════════════════════════════════════════════════════════════════════════
// USER MANAGEMENT QUERIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get all users in the system (admin view)
 * Equivalent to: GET /api/admin/users
 */
export const getAllUsers = query({
  args: {
    role: v.optional(
      v.union(
        v.literal("cleaner"),
        v.literal("manager"),
        v.literal("property_ops"),
        v.literal("admin"),
        v.literal("owner")
      )
    ),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Admin-only — the Companies Hub (/companies) is its only caller and that
    // page is now admin-only, so no non-admin should reach this all-users list.
    await requireRole(ctx, ["admin"]);

    // Read-cost: this used to always `.collect()` the whole `users` table and then
    // apply `args.role` in JS — so `getAllUsers({ role: "cleaner" })` scanned every
    // user to keep a handful. `users.by_role` already exists and bounds it exactly.
    // The unfiltered branch has no argument to bound on (the Companies Hub genuinely
    // wants every user), so it stays a scan — `users` is a small table.
    const users = args.role
      ? await ctx.db
          .query("users")
          .withIndex("by_role", (q) => q.eq("role", args.role!))
          .collect()
      : await ctx.db.query("users").collect();

    // Get role assignments for each user
    const usersWithRoles = await Promise.all(
      users.map(async (user) => {
        const roles = await ctx.db
          .query("userRoles")
          .withIndex("by_active", (q) =>
            q.eq("userId", user._id).eq("revokedAt", undefined)
          )
          .collect();

        return {
          ...user,
          roles: roles.map((r) => r.role),
        };
      })
    );

    return {
      users: usersWithRoles,
      total: usersWithRoles.length,
    };
  },
});

/**
 * Lightweight users query for people screens
 */
export const getUsers = query({
  handler: async (ctx) => {
    await requireAuth(ctx);

    const users = await ctx.db.query("users").collect();
    return users.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  },
});

/**
 * Team metrics for Team Management screen.
 * Single source of truth for UI statistics and status labels.
 */
export const getTeamMetrics = query({
  args: {
    lookbackDays: v.optional(v.number()),
    horizonHours: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireRole(ctx, ["admin", "property_ops", "manager"]);

    const now = Date.now();
    const lookbackDays = Math.min(
      365,
      Math.max(1, Math.floor(args.lookbackDays ?? 30)),
    );
    const horizonHours = Math.min(
      168,
      Math.max(1, Math.floor(args.horizonHours ?? 24)),
    );
    const lookbackStart = now - lookbackDays * 24 * 60 * 60 * 1000;
    const horizonEnd = now + horizonHours * 60 * 60 * 1000;

    // Read-cost: this query is subscribed on the Team page and previously did
    // `ctx.db.query("cleaningJobs").collect()` — a full scan of the largest,
    // most-written table on every reactive tick (~773 MB/mo). The bulk of that
    // table is old COMPLETED history that no metric here can use.
    //
    // Bounded replacement = union of:
    //  (a) jobs scheduled within the metric window, plus a buffer. We can't
    //      index on `metricTimestamp` (actualEndAt ?? approvedAt ?? rejectedAt
    //      ?? scheduledEndAt ?? scheduledStartAt) since those fields have no
    //      index, so we bound on `by_scheduled` and still apply the exact
    //      `isWithinLookback` filter in memory. The buffer covers jobs completed
    //      some time after they were scheduled; no lower bound is needed on the
    //      future side because future-scheduled jobs are ACTIVE and arrive via (b).
    //  (b) every job in an ACTIVE status regardless of date — `activeAssignmentsCount`
    //      and `pickAvailability` are NOT window-filtered, so a stale open job
    //      scheduled before the window must still be counted. Active jobs are a
    //      small operational set (unlike completed history, they don't accumulate).
    const activeStatuses = [...ACTIVE_ASSIGNMENT_STATUSES];
    const [users, memberships, ownerships, windowJobs, ...activeJobsByStatus] =
      await Promise.all([
        ctx.db.query("users").collect(),
        ctx.db.query("companyMembers").collect(),
        ctx.db.query("propertyOwners").collect(),
        ctx.db
          .query("cleaningJobs")
          .withIndex("by_scheduled", (q) =>
            q.gte("scheduledStartAt", lookbackStart - METRIC_SCHEDULE_BUFFER_MS),
          )
          .collect(),
        ...activeStatuses.map((status) =>
          ctx.db
            .query("cleaningJobs")
            .withIndex("by_status", (q) => q.eq("status", status))
            .collect(),
        ),
      ]);

    const jobById = new Map<Id<"cleaningJobs">, Doc<"cleaningJobs">>();
    for (const job of windowJobs) {
      jobById.set(job._id, job);
    }
    for (const statusJobs of activeJobsByStatus) {
      for (const job of statusJobs) {
        jobById.set(job._id, job);
      }
    }
    const jobs = [...jobById.values()];
    const stakesByUser = groupActiveByUser(ownerships);

    const activeMembershipByUserId = new Map<Id<"users">, Doc<"companyMembers">>();
    for (const membership of memberships) {
      if (!membership.isActive || membership.leftAt !== undefined) {
        continue;
      }

      const current = activeMembershipByUserId.get(membership.userId);
      if (!current || membership.joinedAt > current.joinedAt) {
        activeMembershipByUserId.set(membership.userId, membership);
      }
    }

    const actorMembership = activeMembershipByUserId.get(actor._id) ?? null;
    const managerCompanyId =
      actor.role === "manager" ? actorMembership?.companyId ?? null : null;

    const visibleUsers =
      actor.role === "manager"
        ? managerCompanyId
          ? users.filter(
              (user) =>
                activeMembershipByUserId.get(user._id)?.companyId === managerCompanyId,
            )
          : []
        : users;

    let visibleJobs = jobs;
    if (actor.role === "manager") {
      if (!managerCompanyId) {
        visibleJobs = [];
      } else {
        const companyAssignments = await ctx.db
          .query("companyProperties")
          .withIndex("by_company", (q) => q.eq("companyId", managerCompanyId))
          .collect();
        const scopedPropertyIds = new Set(
          companyAssignments
            .filter(isActiveCompanyPropertyAssignment)
            .map((assignment) => assignment.propertyId),
        );
        visibleJobs = jobs.filter((job) => scopedPropertyIds.has(job.propertyId));
      }
    }

    const jobsByUserId = new Map<Id<"users">, Doc<"cleaningJobs">[]>();
    for (const user of visibleUsers) {
      jobsByUserId.set(user._id, []);
    }

    for (const job of visibleJobs) {
      const participantIds = new Set<Id<"users">>(job.assignedCleanerIds);
      if (job.assignedManagerId) {
        participantIds.add(job.assignedManagerId);
      }

      for (const participantId of participantIds) {
        if (!jobsByUserId.has(participantId)) {
          continue;
        }
        jobsByUserId.get(participantId)!.push(job);
      }
    }

    const companyIds = [
      ...new Set(
        visibleUsers
          .map((user) => activeMembershipByUserId.get(user._id)?.companyId ?? null)
          .filter((companyId): companyId is Id<"cleaningCompanies"> => companyId !== null),
      ),
    ];
    const companies = await Promise.all(companyIds.map((companyId) => ctx.db.get(companyId)));
    const companyById = new Map(
      companies
        .filter((company): company is NonNullable<typeof company> => company !== null)
        .map((company) => [company._id, company] as const),
    );

    const members = visibleUsers
      .map((user) => {
        const assignedJobs = jobsByUserId.get(user._id) ?? [];
        const inWindowJobs = assignedJobs.filter((job) =>
          isWithinLookback(job, lookbackStart),
        );

        const activeAssignmentsCount = assignedJobs.filter((job) =>
          ACTIVE_ASSIGNMENT_STATUSES.has(job.status),
        ).length;

        const qualityRatedJobs = inWindowJobs.filter((job) =>
          QUALITY_RATED_STATUSES.has(job.status),
        );
        const qualityPositiveJobs = qualityRatedJobs.filter((job) =>
          QUALITY_POSITIVE_STATUSES.has(job.status),
        );
        const qualityScore =
          qualityRatedJobs.length > 0
            ? Number(
                clamp((5 * qualityPositiveJobs.length) / qualityRatedJobs.length, 0, 5).toFixed(2),
              )
            : null;

        const durationJobs = inWindowJobs.filter(
          (job) =>
            typeof job.actualStartAt === "number" &&
            typeof job.actualEndAt === "number" &&
            job.actualEndAt >= job.actualStartAt,
        );
        const avgDurationMinutes =
          durationJobs.length > 0
            ? Math.round(
                durationJobs.reduce(
                  (total, job) => total + (job.actualEndAt! - job.actualStartAt!),
                  0,
                ) /
                  durationJobs.length /
                  (1000 * 60),
              )
            : null;

        const onTimeEligibleJobs = inWindowJobs.filter(
          (job) =>
            QUALITY_RATED_STATUSES.has(job.status) &&
            typeof job.scheduledEndAt === "number" &&
            typeof (job.actualEndAt ?? job.approvedAt ?? job.rejectedAt) === "number",
        );
        const onTimeJobs = onTimeEligibleJobs.filter((job) => {
          const completionTime = job.actualEndAt ?? job.approvedAt ?? job.rejectedAt;
          return typeof completionTime === "number" && completionTime <= job.scheduledEndAt;
        });
        const onTimePct =
          onTimeEligibleJobs.length > 0
            ? Math.round((onTimeJobs.length / onTimeEligibleJobs.length) * 100)
            : null;

        const completedJobsCount = inWindowJobs.filter(
          (job) => job.status === "completed",
        ).length;

        const activeMembership = activeMembershipByUserId.get(user._id);
        const company = activeMembership
          ? companyById.get(activeMembership.companyId) ?? null
          : null;

        return {
          _id: user._id,
          clerkId: user.clerkId,
          email: user.email,
          name: user.name,
          phone: user.phone,
          avatarUrl: user.avatarUrl,
          role: user.role,
          // Owners only: how many distinct properties they hold an ACTIVE
          // stake in. 0 = role/ownership drift (flagged in the UI).
          ownedPropertyCount:
            user.role === "owner"
              ? new Set(
                  (stakesByUser.get(user._id) ?? []).map((o) => o.propertyId),
                ).size
              : null,
          availability: pickAvailability(assignedJobs, now, horizonEnd),
          onTimePct,
          qualityScore,
          avgDurationMinutes,
          activeAssignmentsCount,
          completedJobsCount,
          companyId: activeMembership?.companyId ?? null,
          companyName: company?.name ?? null,
          companyMemberRole: activeMembership?.role ?? null,
        };
      })
      .sort((a, b) => normalizeName(a).localeCompare(normalizeName(b)));

    return {
      generatedAt: now,
      lookbackDays,
      horizonHours,
      members,
    };
  },
});

/**
 * Get a single user by ID with detailed information
 * Equivalent to: GET /api/admin/users/[id]
 */
export const getUserById = query({
  args: { id: v.id("users") },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin", "manager"]);

    const user = await ctx.db.get(args.id);
    if (!user) return null;

    // Get user's roles
    const roles = await ctx.db
      .query("userRoles")
      .withIndex("by_active", (q) =>
        q.eq("userId", args.id).eq("revokedAt", undefined)
      )
      .collect();

    // Get user stats - jobs completed
    const completedJobs = await ctx.db
      .query("cleaningJobs")
      .filter((q) =>
        q.and(
          q.eq(q.field("status"), "completed"),
          // Check if user is in assignedCleanerIds array
          q.or(
            q.eq(q.field("assignedManagerId"), args.id),
            // For cleaners, we need to check array membership
            // This is a workaround since Convex doesn't have native array contains
            q.neq(q.field("assignedCleanerIds"), [])
          )
        )
      )
      .collect();

    // Filter jobs where user is actually a cleaner
    const userJobs = completedJobs.filter(
      (job) =>
        job.assignedManagerId === args.id ||
        job.assignedCleanerIds.includes(args.id)
    );

    // Get recent jobs (last 10)
    const allJobs = await ctx.db
      .query("cleaningJobs")
      .filter((q) =>
        q.or(
          q.eq(q.field("assignedManagerId"), args.id),
          q.neq(q.field("assignedCleanerIds"), [])
        )
      )
      .order("desc")
      .take(50);

    const recentJobs = allJobs
      .filter(
        (job) =>
          job.assignedManagerId === args.id ||
          job.assignedCleanerIds.includes(args.id)
      )
      .slice(0, 10);

    return {
      ...user,
      roles: roles.map((r) => r.role),
      stats: {
        jobsCompleted: userJobs.length,
      },
      recentJobs,
    };
  },
});

/**
 * Get user by Clerk ID
 */
export const getUserByClerkId = query({
  args: { clerkId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .first();

    return user;
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD STATISTICS QUERIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get dashboard statistics for admin overview
 * Comprehensive stats across properties, users, and jobs
 */
export const getDashboardStats = query({
  handler: async (ctx) => {
    await requireAuth(ctx);

    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    // Get all properties
    const properties = await ctx.db.query("properties").collect();
    const totalProperties = properties.length;
    const activeProperties = properties.filter((p) => p.isActive).length;

    // Get all users
    const users = await ctx.db.query("users").collect();
    const totalUsers = users.length;
    const cleaners = users.filter((u) => u.role === "cleaner").length;
    const managers = users.filter((u) => u.role === "manager").length;
    const admins = users.filter((u) => u.role === "admin").length;

    // Get cleaning jobs stats
    const allJobs = await ctx.db.query("cleaningJobs").collect();

    const recentJobs = allJobs.filter((j) => j.createdAt >= thirtyDaysAgo);
    const pendingJobs = allJobs.filter((j) => j.status === "scheduled");
    const inProgressJobs = allJobs.filter((j) => j.status === "in_progress");
    const awaitingApprovalJobs = allJobs.filter(
      (j) => j.status === "awaiting_approval"
    );
    const completedJobs = allJobs.filter(
      (j) => j.status === "completed" && j.actualEndAt && j.actualEndAt >= thirtyDaysAgo
    );

    // Get today's jobs
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const todaysJobs = allJobs.filter(
      (j) =>
        j.scheduledStartAt >= todayStart.getTime() &&
        j.scheduledStartAt <= todayEnd.getTime()
    );

    // Get upcoming jobs (next 7 days)
    const nextWeek = now + 7 * 24 * 60 * 60 * 1000;
    const upcomingJobs = allJobs.filter(
      (j) =>
        j.scheduledStartAt >= now &&
        j.scheduledStartAt <= nextWeek &&
        (j.status === "scheduled" || j.status === "assigned")
    );

    // Calculate completion rate
    const completionRate =
      recentJobs.length > 0
        ? Math.round(
            (completedJobs.length / recentJobs.length) * 100 * 10
          ) / 10
        : 0;

    return {
      properties: {
        total: totalProperties,
        active: activeProperties,
      },
      users: {
        total: totalUsers,
        cleaners,
        managers,
        admins,
      },
      jobs: {
        total: allJobs.length,
        last30Days: recentJobs.length,
        pending: pendingJobs.length,
        inProgress: inProgressJobs.length,
        awaitingApproval: awaitingApprovalJobs.length,
        completed: completedJobs.length,
        today: todaysJobs.length,
        upcoming: upcomingJobs.length,
        completionRate,
      },
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMPANY MANAGEMENT QUERIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get all cleaning companies with their properties and members
 * Equivalent to: GET /api/admin/cleaners/companies
 */
export const getAllCompanies = query({
  handler: async (ctx) => {
    await requireRole(ctx, ["admin", "property_ops", "manager"]);

    const companies = await ctx.db.query("cleaningCompanies").collect();

    // Enrich each company with properties and members
    const enrichedCompanies = await Promise.all(
      companies.map(async (company) => {
        // Get assigned properties
        const companyProperties = await ctx.db
          .query("companyProperties")
          .withIndex("by_company", (q) => q.eq("companyId", company._id))
          .collect();

        // Get property details
        const propertiesWithDetails = await Promise.all(
          companyProperties.map(async (cp) => {
            const property = await ctx.db.get(cp.propertyId);
            return {
              propertyId: cp.propertyId,
              assignedAt: cp.assignedAt,
              property: property
                ? { id: property._id, name: property.name, address: property.address }
                : null,
            };
          })
        );

        // Get company members
        const members = await ctx.db
          .query("companyMembers")
          .withIndex("by_company", (q) => q.eq("companyId", company._id))
          .collect();

        // Get member details
        const membersWithDetails = await Promise.all(
          members.map(async (member) => {
            const user = await ctx.db.get(member.userId);
            return {
              userId: member.userId,
              role: member.role,
              joinedAt: member.joinedAt,
              isActive: member.isActive,
              user: user
                ? { name: user.name, email: user.email }
                : null,
            };
          })
        );

        return {
          ...company,
          properties: propertiesWithDetails,
          members: membersWithDetails,
        };
      })
    );

    return { companies: enrichedCompanies };
  },
});

/**
 * Lightweight companies query for people screens
 */
export const getCompanies = query({
  handler: async (ctx) => {
    await requireAuth(ctx);

    const companies = await ctx.db
      .query("cleaningCompanies")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .collect();

    const dedupedByName = new Map<string, (typeof companies)[number]>();
    for (const company of companies) {
      const key = company.name.trim().toLowerCase();
      const current = dedupedByName.get(key);
      if (!current) {
        dedupedByName.set(key, company);
        continue;
      }

      const currentUpdatedAt = current.updatedAt ?? current.createdAt;
      const candidateUpdatedAt = company.updatedAt ?? company.createdAt;
      if (candidateUpdatedAt > currentUpdatedAt) {
        dedupedByName.set(key, company);
      }
    }

    return Array.from(dedupedByName.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  },
});

/**
 * Active company memberships for a set of users.
 * Used by team-management UIs to display and edit company assignment.
 */
export const getCompanyMembershipsForUsers = query({
  args: {
    userIds: v.array(v.id("users")),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const dedupedUserIds = [...new Set(args.userIds)];
    const memberships: Array<{
      userId: Id<"users">;
      companyId: Id<"cleaningCompanies">;
      companyName: string;
      memberRole: "cleaner" | "manager" | "owner";
    }> = [];

    for (const userId of dedupedUserIds) {
      const userMemberships = await ctx.db
        .query("companyMembers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();

      const activeMembership = userMemberships
        .filter((membership) => membership.isActive && membership.leftAt === undefined)
        .sort((a, b) => b.joinedAt - a.joinedAt)[0];

      if (!activeMembership) {
        continue;
      }

      const company = await ctx.db.get(activeMembership.companyId);
      memberships.push({
        userId,
        companyId: activeMembership.companyId,
        companyName: company?.name ?? "Unknown company",
        memberRole: activeMembership.role,
      });
    }

    return memberships;
  },
});

/**
 * Get a single company by ID with full details
 */
export const getCompanyById = query({
  args: { id: v.id("cleaningCompanies") },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin", "property_ops", "manager"]);

    const company = await ctx.db.get(args.id);
    if (!company) return null;

    // Get assigned properties
    const companyProperties = await ctx.db
      .query("companyProperties")
      .withIndex("by_company", (q) => q.eq("companyId", args.id))
      .collect();

    const propertiesWithDetails = await Promise.all(
      companyProperties.map(async (cp) => {
        const property = await ctx.db.get(cp.propertyId);
        return {
          ...cp,
          property,
        };
      })
    );

    // Get company members
    const members = await ctx.db
      .query("companyMembers")
      .withIndex("by_company", (q) => q.eq("companyId", args.id))
      .collect();

    const membersWithDetails = await Promise.all(
      members.map(async (member) => {
        const user = await ctx.db.get(member.userId);
        return {
          ...member,
          user,
        };
      })
    );

    return {
      ...company,
      properties: propertiesWithDetails,
      members: membersWithDetails,
    };
  },
});

export const getPropertyCompanyAssignment = query({
  args: {
    propertyId: v.id("properties"),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin", "property_ops", "manager"]);

    const property = await ctx.db.get(args.propertyId);
    if (!property || !property.isActive) {
      return null;
    }

    const assignments = await ctx.db
      .query("companyProperties")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();

    const sortedAssignments = assignments.sort(
      (a, b) => b.assignedAt - a.assignedAt,
    );
    const activeAssignment = sortedAssignments.find(isActiveCompanyPropertyAssignment) ?? null;

    const companyIds = [
      ...new Set(sortedAssignments.map((assignment) => assignment.companyId)),
    ];
    const userIds = [
      ...new Set(
        sortedAssignments.flatMap((assignment) =>
          [assignment.assignedBy, assignment.unassignedBy].filter(
            (id): id is Id<"users"> => Boolean(id),
          ),
        ),
      ),
    ];

    const [companies, users] = await Promise.all([
      Promise.all(companyIds.map((companyId) => ctx.db.get(companyId))),
      Promise.all(userIds.map((userId) => ctx.db.get(userId))),
    ]);

    const companyById = new Map(
      companies
        .filter((company): company is NonNullable<typeof company> => company !== null)
        .map((company) => [company._id, company] as const),
    );
    const userById = new Map(
      users
        .filter((user): user is NonNullable<typeof user> => user !== null)
        .map((user) => [user._id, user] as const),
    );

    const history = sortedAssignments.map((assignment) => ({
      _id: assignment._id,
      companyId: assignment.companyId,
      companyName: companyById.get(assignment.companyId)?.name ?? "Unknown company",
      assignedAt: assignment.assignedAt,
      assignedBy: assignment.assignedBy ?? null,
      assignedByName: assignment.assignedBy
        ? userById.get(assignment.assignedBy)?.name ?? userById.get(assignment.assignedBy)?.email ?? null
        : null,
      isActive: isActiveCompanyPropertyAssignment(assignment),
      unassignedAt: assignment.unassignedAt ?? null,
      unassignedBy: assignment.unassignedBy ?? null,
      unassignedByName: assignment.unassignedBy
        ? userById.get(assignment.unassignedBy)?.name ?? userById.get(assignment.unassignedBy)?.email ?? null
        : null,
      unassignedReason: assignment.unassignedReason ?? null,
    }));

    return {
      property: {
        _id: property._id,
        name: property.name,
        address: property.address,
        city: property.city ?? null,
        state: property.state ?? null,
      },
      activeAssignment: activeAssignment
        ? {
            _id: activeAssignment._id,
            companyId: activeAssignment.companyId,
            companyName:
              companyById.get(activeAssignment.companyId)?.name ?? "Unknown company",
            assignedAt: activeAssignment.assignedAt,
            assignedBy: activeAssignment.assignedBy ?? null,
            assignedByName: activeAssignment.assignedBy
              ? userById.get(activeAssignment.assignedBy)?.name ??
                userById.get(activeAssignment.assignedBy)?.email ??
                null
              : null,
          }
        : null,
      history,
    };
  },
});

export const listCompanyPropertyAssignments = query({
  args: {
    companyId: v.optional(v.id("cleaningCompanies")),
    city: v.optional(v.string()),
    includeUnassigned: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin", "property_ops", "manager"]);

    const includeUnassigned = args.includeUnassigned ?? false;
    const cityFilter = args.city?.trim().toLowerCase();
    const limit = Math.max(1, Math.min(args.limit ?? 250, 500));

    // Read-cost: this used to `.collect()` companyProperties, cleaningCompanies
    // AND users in full — three bare table scans — right next to a correctly
    // `by_active`-bounded properties read, throwing that win away. It's subscribed
    // from the Properties page (the highest-traffic mount) and companies-hub, so
    // every write to ANY user, company, or assignment re-ran all three scans. The
    // `limit` arg (up to 500) was applied post-scan and bounded nothing.
    //
    // It only ever needs: the assignments of the properties actually shown, the
    // companies those assignments reference, and the users that made them. So
    // narrow the property set first (the city filter reads only property fields),
    // then fan out from it by index / deduped id.
    const activeProperties = await ctx.db
      .query("properties")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .collect();

    const properties = activeProperties.filter((property) => {
      if (!cityFilter) return true;
      const value = `${property.city ?? ""} ${property.state ?? ""}`.toLowerCase();
      return value.includes(cityFilter);
    });

    const perProperty = await Promise.all(
      properties.map((property) =>
        ctx.db
          .query("companyProperties")
          .withIndex("by_property", (q) => q.eq("propertyId", property._id))
          .collect(),
      ),
    );

    const assignmentsByPropertyId = new Map<Id<"properties">, Doc<"companyProperties">[]>();
    properties.forEach((property, index) => {
      assignmentsByPropertyId.set(property._id, perProperty[index]);
    });

    const assignments = perProperty.flat();
    const companyIds = [...new Set(assignments.map((a) => a.companyId))];
    const assignedByIds = [
      ...new Set(
        assignments
          .map((a) => a.assignedBy)
          .filter((id): id is Id<"users"> => Boolean(id)),
      ),
    ];
    const [companyDocs, userDocs] = await Promise.all([
      Promise.all(companyIds.map((id) => ctx.db.get(id))),
      Promise.all(assignedByIds.map((id) => ctx.db.get(id))),
    ]);
    const companyById = new Map(
      companyDocs
        .filter((company): company is NonNullable<typeof company> => company !== null)
        .map((company) => [company._id, company] as const),
    );
    const userById = new Map(
      userDocs
        .filter((user): user is NonNullable<typeof user> => user !== null)
        .map((user) => [user._id, user] as const),
    );

    const rows = properties
      .map((property) => {
        const propertyAssignments = (assignmentsByPropertyId.get(property._id) ?? []).sort(
          (a, b) => b.assignedAt - a.assignedAt,
        );
        const activeAssignment =
          propertyAssignments.find(isActiveCompanyPropertyAssignment) ?? null;

        return {
          propertyId: property._id,
          propertyName: property.name,
          address: property.address,
          city: property.city ?? null,
          state: property.state ?? null,
          activeAssignment: activeAssignment
            ? {
                assignmentId: activeAssignment._id,
                companyId: activeAssignment.companyId,
                companyName:
                  companyById.get(activeAssignment.companyId)?.name ?? "Unknown company",
                assignedAt: activeAssignment.assignedAt,
                assignedBy: activeAssignment.assignedBy ?? null,
                assignedByName: activeAssignment.assignedBy
                  ? userById.get(activeAssignment.assignedBy)?.name ??
                    userById.get(activeAssignment.assignedBy)?.email ??
                    null
                  : null,
              }
            : null,
          assignmentsCount: propertyAssignments.length,
          history: propertyAssignments.slice(0, 6).map((assignment) => ({
            assignmentId: assignment._id,
            companyId: assignment.companyId,
            companyName:
              companyById.get(assignment.companyId)?.name ?? "Unknown company",
            assignedAt: assignment.assignedAt,
            assignedBy: assignment.assignedBy ?? null,
            assignedByName: assignment.assignedBy
              ? userById.get(assignment.assignedBy)?.name ??
                userById.get(assignment.assignedBy)?.email ??
                null
              : null,
            isActive: isActiveCompanyPropertyAssignment(assignment),
            unassignedAt: assignment.unassignedAt ?? null,
            unassignedReason: assignment.unassignedReason ?? null,
          })),
        };
      })
      .filter((row) => {
        if (args.companyId && row.activeAssignment?.companyId !== args.companyId) {
          return false;
        }
        if (!includeUnassigned && !row.activeAssignment) {
          return false;
        }
        return true;
      })
      .sort((a, b) => a.propertyName.localeCompare(b.propertyName))
      .slice(0, limit);

    return {
      rows,
      total: rows.length,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN METRICS QUERIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get metrics for all admin tools
 * Equivalent to: GET /api/admin/metrics
 */
export const getAllToolsMetrics = query({
  handler: async (ctx) => {
    await requireAuth(ctx);

    const [
      cleanersMetrics,
      propertiesMetrics,
      reviewsMetrics,
      strCostsMetrics,
      dealVettingMetrics,
      designStoriesMetrics,
    ] = await Promise.all([
      getCleanersMetricsInternal(ctx),
      getPropertyMetricsInternal(ctx),
      getReviewsMetricsInternal(),
      getSTRCostsMetricsInternal(),
      getDealVettingMetricsInternal(),
      getDesignStoriesMetricsInternal(),
    ]);

    return {
      "cleaners-inspection": cleanersMetrics,
      "property-management": propertiesMetrics,
      "reviews-sync": reviewsMetrics,
      "str-costs": strCostsMetrics,
      "deal-vetting": dealVettingMetrics,
      "design-stories": designStoriesMetrics,
    };
  },
});

/**
 * Get metrics for cleaners/inspection tool
 */
export const getCleanersMetrics = query({
  handler: async (ctx) => {
    await requireAuth(ctx);
    return getCleanersMetricsInternal(ctx);
  },
});

// Internal helper for cleaners metrics
async function getCleanersMetricsInternal(ctx: QueryCtx) {
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

  const allJobs = await ctx.db.query("cleaningJobs").collect();

  // Today's jobs
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const todayJobs = allJobs.filter(
    (job) =>
      job.scheduledStartAt >= todayStart.getTime() &&
      job.scheduledStartAt <= todayEnd.getTime()
  );

  // Pending reviews
  const pendingReviews = allJobs.filter((job) => job.status === "awaiting_approval");

  // Upcoming jobs (next 7 days)
  const nextWeek = now + 7 * 24 * 60 * 60 * 1000;
  const upcomingJobs = allJobs.filter(
    (job) =>
      job.scheduledStartAt >= now &&
      job.scheduledStartAt <= nextWeek &&
      (job.status === "scheduled" || job.status === "assigned")
  );

  // Active cleaners (with jobs in last 30 days)
  const recentJobs = allJobs.filter((job) => job.scheduledStartAt >= thirtyDaysAgo);
  const uniqueCleaners = new Set<string>();
  recentJobs.forEach((job) => {
    if (job.assignedCleanerIds && Array.isArray(job.assignedCleanerIds)) {
      job.assignedCleanerIds.forEach((id: string) => uniqueCleaners.add(id));
    }
  });

  // Completion rate
  const completedCount = recentJobs.filter((job) => job.status === "completed").length;
  const completionRate =
    recentJobs.length > 0
      ? Math.round((completedCount / recentJobs.length) * 100 * 10) / 10
      : 0;

  // Determine status
  let status = "setup_needed";
  if (allJobs.length > 0) {
    if (pendingReviews.length > 5) {
      status = "needs_attention";
    } else {
      status = "active";
    }
  }

  return {
    totalJobs: allJobs.length,
    todayInspections: todayJobs.length,
    pendingReviews: pendingReviews.length,
    activeCleaners: uniqueCleaners.size,
    completionRate,
    upcomingJobs: upcomingJobs.length,
    status,
  };
}

// Internal helper for property metrics
async function getPropertyMetricsInternal(ctx: QueryCtx) {
  const properties = await ctx.db.query("properties").collect();

  const totalProperties = properties.length;
  const listedProperties = properties.filter((property) => property.isActive).length;

  // Calculate total guest capacity
  let totalGuestCapacity = 0;
  properties.forEach((property) => {
    if (property.bedrooms) {
      totalGuestCapacity += property.bedrooms * 2; // Estimate 2 guests per bedroom
    }
  });

  const averageGuestCapacity =
    totalProperties > 0 ? Math.round(totalGuestCapacity / totalProperties) : 0;

  return {
    totalProperties,
    listedProperties,
    totalGuestCapacity,
    averageGuestCapacity,
    status: totalProperties > 0 ? "active" : "setup_needed",
  };
}

// Internal helper for reviews metrics
async function getReviewsMetricsInternal() {
  return {
    totalImported: 0,
    totalReviews: 0,
    averageRating: 0,
    lastSyncAt: null,
    status: "needs_sync",
  };
}

// Internal helper for STR costs metrics
async function getSTRCostsMetricsInternal() {
  return {
    totalImports: 0,
    totalCalculations: 0,
    totalCostItems: 0,
    apiConnectionsCount: 0,
    lastImportDate: null,
    status: "setup_needed",
  };
}

// Internal helper for deal vetting metrics
async function getDealVettingMetricsInternal() {
  return {
    totalEvaluations: 0,
    passedDeals: 0,
    watchDeals: 0,
    failedDeals: 0,
    averageScore: 0,
    averageMonthlyNet: 0,
    lastEvaluationAt: null,
    status: "setup_needed",
  };
}

// Internal helper for design stories metrics
async function getDesignStoriesMetricsInternal() {
  return {
    totalStories: 0,
    publishedStories: 0,
    draftStories: 0,
    archivedStories: 0,
    lastPublishedAt: null,
    lastUpdatedAt: null,
    status: "empty",
  };
}

/**
 * Get user management metrics
 */
export const getUserManagementMetrics = query({
  handler: async (ctx) => {
    await requireAuth(ctx);

    const users = await ctx.db.query("users").collect();

    // Count roles
    const roleCounts: Record<string, number> = {};
    users.forEach((user) => {
      const role = user.role || "user";
      roleCounts[role] = (roleCounts[role] || 0) + 1;
    });

    // Last user created
    const sortedUsers = [...users].sort(
      (a, b) => (b.createdAt || 0) - (a.createdAt || 0)
    );
    const lastUserCreatedAt =
      sortedUsers.length > 0
        ? new Date(sortedUsers[0].createdAt).toISOString()
        : null;

    return {
      totalUsers: users.length,
      totalRoles: Object.keys(roleCounts).length,
      roleCounts,
      pendingInvites: 0, // Would need to track invites separately
      onlineUsers: 0, // Would need real-time presence tracking
      lastUserCreatedAt,
      status: users.length > 0 ? "active" : "setup_needed",
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH 3: ADMIN ANALYTICS & JOB MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get detailed analytics for admin analytics dashboard
 * Comprehensive job metrics, completion rates, top performers, incidents
 */
export const getAnalytics = query({
  handler: async (ctx) => {
    await requireAuth(ctx);

    // Get all jobs
    const allJobs = await ctx.db.query("cleaningJobs").collect();
    const totalJobs = allJobs.length;

    // Completed jobs
    const completedJobs = allJobs.filter(j => j.status === "completed");
    const completedJobsCount = completedJobs.length;

    // Completion rate
    const completionRate = totalJobs > 0
      ? (completedJobsCount / totalJobs) * 100
      : 0;

    // Calculate average response time (scheduled_start_at to actual_start_at)
    const jobsWithResponseTime = allJobs.filter(
      j => j.actualStartAt && j.scheduledStartAt
    );
    const totalResponseTime = jobsWithResponseTime.reduce((sum, job) => {
      return sum + (job.actualStartAt! - job.scheduledStartAt);
    }, 0);
    const averageResponseTime = jobsWithResponseTime.length > 0
      ? totalResponseTime / jobsWithResponseTime.length / (1000 * 60 * 60) // hours
      : 0;

    // Calculate average job duration (actual_start_at to actual_end_at)
    const jobsWithDuration = completedJobs.filter(
      j => j.actualStartAt && j.actualEndAt
    );
    const totalDuration = jobsWithDuration.reduce((sum, job) => {
      return sum + (job.actualEndAt! - job.actualStartAt!);
    }, 0);
    const averageJobDuration = jobsWithDuration.length > 0
      ? totalDuration / jobsWithDuration.length / (1000 * 60 * 60) // hours
      : 0;

    // Jobs by status
    const jobsByStatus = {
      scheduled: allJobs.filter(j => j.status === "scheduled").length,
      assigned: allJobs.filter(j => j.status === "assigned").length,
      in_progress: allJobs.filter(j => j.status === "in_progress").length,
      awaiting_approval: allJobs.filter(j => j.status === "awaiting_approval").length,
      rework_required: allJobs.filter(j => j.status === "rework_required").length,
      completed: completedJobsCount,
      cancelled: allJobs.filter(j => j.status === "cancelled").length,
    };

    // Top performers - cleaners with most completed jobs
    const cleanerJobCounts: { [key: string]: number } = {};
    completedJobs.forEach(job => {
      if (job.assignedCleanerIds && job.assignedCleanerIds.length > 0) {
        job.assignedCleanerIds.forEach(cleanerId => {
          cleanerJobCounts[cleanerId] = (cleanerJobCounts[cleanerId] || 0) + 1;
        });
      }
    });

    // Get cleaner names
    const topPerformerIds = Object.entries(cleanerJobCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id]) => id);

    const topPerformers = await Promise.all(
      topPerformerIds.map(async (cleanerId) => {
        const user = await ctx.db.get(cleanerId as Id<"users">);
        return {
          cleaner_id: cleanerId,
          cleaner_name: user?.name || "Unknown",
          completed_jobs: cleanerJobCounts[cleanerId],
        };
      })
    );

    // Incident statistics
    const allIncidents = await ctx.db.query("incidents").collect();
    const incidentStats = {
      total: allIncidents.length,
      open: allIncidents.filter(i => i.status === "open").length,
      resolved: allIncidents.filter(i => i.status === "resolved").length,
      byType: {
        missing_item: allIncidents.filter(i => i.incidentType === "missing_item").length,
        damaged_item: allIncidents.filter(i => i.incidentType === "damaged_item").length,
        suggestion: allIncidents.filter(i => i.incidentType === "suggestion").length,
      },
    };

    // Jobs over last 7 days
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - i));
      date.setHours(0, 0, 0, 0);
      return date;
    });

    const jobsLast7Days = last7Days.map(date => {
      const dayStart = date.getTime();
      const dayEnd = dayStart + 24 * 60 * 60 * 1000;
      const count = allJobs.filter(
        j => j.createdAt >= dayStart && j.createdAt < dayEnd
      ).length;
      return {
        date: date.toISOString().split('T')[0],
        count,
      };
    });

    return {
      totalJobs,
      completedJobs: completedJobsCount,
      completionRate,
      averageResponseTime,
      averageJobDuration,
      jobsByStatus,
      topPerformers,
      incidentStats,
      jobsLast7Days,
    };
  },
});

/**
 * Get all jobs with optional filtering (admin view)
 * Used by the admin jobs list screen
 */
export const getAllJobs = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("scheduled"),
        v.literal("assigned"),
        v.literal("in_progress"),
        v.literal("awaiting_approval"),
        v.literal("rework_required"),
        v.literal("completed"),
        v.literal("cancelled")
      )
    ),
    propertyId: v.optional(v.id("properties")),
    cleanerId: v.optional(v.id("users")),
    riskOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    // Get all jobs
    let jobs = await ctx.db
      .query("cleaningJobs")
      .order("desc")
      .collect();

    // Apply filters
    if (args.status) {
      jobs = jobs.filter(j => j.status === args.status);
    }

    if (args.propertyId) {
      jobs = jobs.filter(j => j.propertyId === args.propertyId);
    }

    if (args.cleanerId) {
      jobs = jobs.filter(
        j => j.assignedCleanerIds.includes(args.cleanerId!)
      );
    }

    if (args.riskOnly) {
      jobs = jobs.filter(j => j.partyRiskFlag || j.opsRiskFlag);
    }

    // Enrich jobs with property details
    const enrichedJobs = await Promise.all(
      jobs.map(async (job) => {
        const property = await ctx.db.get(job.propertyId);
        return {
          ...job,
          property: property || null,
        };
      })
    );

    return enrichedJobs;
  },
});

/**
 * Get single job by ID with full details (admin view)
 */
export const getJobById = query({
  args: { id: v.id("cleaningJobs") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const job = await ctx.db.get(args.id);
    if (!job) return null;

    // Get property
    const property = await ctx.db.get(job.propertyId);

    // Get assigned cleaners
    const cleaners = await Promise.all(
      job.assignedCleanerIds.map(async (cleanerId) => {
        const user = await ctx.db.get(cleanerId);
        return user;
      })
    );

    // Get manager
    const manager = job.assignedManagerId
      ? await ctx.db.get(job.assignedManagerId)
      : null;

    // Get photos
    const photos = await ctx.db
      .query("photos")
      .withIndex("by_job", (q) => q.eq("cleaningJobId", args.id))
      .collect();

    // Get incidents
    const incidents = await ctx.db
      .query("incidents")
      .withIndex("by_job", (q) => q.eq("cleaningJobId", args.id))
      .collect();

    return {
      ...job,
      property,
      cleaners: cleaners.filter(Boolean),
      manager,
      photos,
      incidents,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH 3: PROPERTY MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get all properties (admin view)
 * Used by the admin properties list screen
 */
export const getAllProperties = query({
  args: {
    activeOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    let properties = await ctx.db.query("properties").collect();

    // Filter by active status if specified
    if (args.activeOnly) {
      properties = properties.filter(p => p.isActive);
    }

    // Sort by name
    properties.sort((a, b) => {
      const nameA = a.name?.toLowerCase() || "";
      const nameB = b.name?.toLowerCase() || "";
      return nameA.localeCompare(nameB);
    });

    return properties;
  },
});

/**
 * Lightweight properties query for people screens
 */
export const getProperties = query({
  handler: async (ctx) => {
    await requireAuth(ctx);

    const properties = await ctx.db.query("properties").collect();
    return properties.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/**
 * Get single property by ID with full details (admin view)
 */
export const getPropertyById = query({
  args: { id: v.id("properties") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const property = await ctx.db.get(args.id);
    if (!property) return null;

    // Get property images
    const images = await ctx.db
      .query("propertyImages")
      .withIndex("by_property", (q) => q.eq("propertyId", args.id))
      .collect();

    // Get property tags
    const tags = await ctx.db
      .query("propertyTags")
      .withIndex("by_property", (q) => q.eq("propertyId", args.id))
      .collect();

    // Get recent jobs for this property
    const recentJobs = await ctx.db
      .query("cleaningJobs")
      .withIndex("by_property", (q) => q.eq("propertyId", args.id))
      .order("desc")
      .take(10);

    // Get upcoming stays
    const now = Date.now();
    const allStays = await ctx.db
      .query("stays")
      .withIndex("by_property", (q) => q.eq("propertyId", args.id))
      .collect();

    const upcomingStays = allStays
      .filter(s => s.checkInAt >= now)
      .sort((a, b) => a.checkInAt - b.checkInAt)
      .slice(0, 5);

    // Get property operations assignments
    const opsAssignments = await ctx.db
      .query("propertyOpsAssignments")
      .withIndex("by_property", (q) => q.eq("propertyId", args.id))
      .collect();

    // Enrich ops assignments with user details
    const enrichedOpsAssignments = await Promise.all(
      opsAssignments.map(async (assignment) => {
        const user = await ctx.db.get(assignment.userId);
        return {
          ...assignment,
          user,
        };
      })
    );

    return {
      ...property,
      images,
      tags: tags.map(t => t.tagName),
      recentJobs,
      upcomingStays,
      opsAssignments: enrichedOpsAssignments,
    };
  },
});
