import { v } from "convex/values";
import { query, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { getCurrentUser, requireRole } from "../lib/auth";

function readThemePreference(metadata: unknown): "dark" | "light" | null {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const theme = (metadata as Record<string, unknown>).theme;
  if (theme === "dark" || theme === "light") {
    return theme;
  }

  return null;
}

function permissionsForRole(role: Doc<"users">["role"]): string[] {
  return [role];
}

function startOfToday(now: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function endOfToday(now: number): number {
  const date = new Date(now);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

async function getLatestActiveMembership(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<Doc<"companyMembers"> | null> {
  const memberships = await ctx.db
    .query("companyMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();

  const active = memberships
    .filter((membership) => membership.isActive && membership.leftAt === undefined)
    .sort((a, b) => b.joinedAt - a.joinedAt);

  return active[0] ?? null;
}

export const getByRole = query({
  args: {
    role: v.string(),
  },
  handler: async (ctx, args) => {
    const users = await ctx.db
      .query("users")
      .withIndex("by_role", (q) =>
        q.eq(
          "role",
          args.role as "cleaner" | "manager" | "property_ops" | "admin",
        ),
      )
      .collect();

    return users.sort((a, b) => {
      const nameA = a.name ?? a.email ?? "";
      const nameB = b.name ?? b.email ?? "";
      return nameA.localeCompare(nameB);
    });
  },
});

export const getByClerkId = query({
  args: {
    clerkId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .first();

    return user ?? null;
  },
});

export const getThemePreference = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);

    return {
      theme: readThemePreference(user.metadata),
      updatedAt: user.updatedAt ?? user.createdAt,
    };
  },
});

export const getLocalePreference = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);

    return {
      locale: user.preferredLocale ?? null,
      role: user.role,
      updatedAt: user.updatedAt ?? user.createdAt,
    };
  },
});

export const getMyProfile = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);

    return {
      ...user,
      id: user._id,
      permissions: permissionsForRole(user.role),
    };
  },
});

export const getMyNotifications = query({
  args: {
    unreadOnly: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    let filtered = notifications.filter(
      (notification) => notification.dismissedAt === undefined,
    );

    if (args.unreadOnly) {
      filtered = filtered.filter((notification) => notification.readAt === undefined);
    }

    filtered.sort((a, b) => b.createdAt - a.createdAt);

    const limit =
      typeof args.limit === "number" && args.limit > 0
        ? Math.floor(args.limit)
        : undefined;

    return limit ? filtered.slice(0, limit) : filtered;
  },
});

export const getUnreadNotificationCount = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);

    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    return notifications.filter(
      (notification) =>
        notification.readAt === undefined && notification.dismissedAt === undefined,
    ).length;
  },
});

export const getManagerDashboard = query({
  args: {},
  handler: async (ctx) => {
    const currentUser = await requireRole(ctx, ["manager", "admin"]);
    const now = Date.now();
    const todayStart = startOfToday(now);
    const todayEnd = endOfToday(now);

    const allJobs = await ctx.db.query("cleaningJobs").collect();
    const managerJobs =
      currentUser.role === "admin"
        ? allJobs
        : allJobs.filter((job) => job.assignedManagerId === currentUser._id);

    const cleanerIds = [
      ...new Set(managerJobs.flatMap((job) => job.assignedCleanerIds)),
    ];
    const cleaners = (
      await Promise.all(cleanerIds.map((cleanerId) => ctx.db.get(cleanerId)))
    ).filter((cleaner): cleaner is NonNullable<typeof cleaner> => cleaner !== null);

    const cleanersWithStats = cleaners
      .map((cleaner) => {
        const cleanerJobs = managerJobs.filter((job) =>
          job.assignedCleanerIds.includes(cleaner._id),
        );
        const todayJobCount = cleanerJobs.filter(
          (job) =>
            job.scheduledStartAt >= todayStart && job.scheduledStartAt <= todayEnd,
        ).length;

        const currentJob = cleanerJobs
          .filter((job) => job.status === "in_progress")
          .sort((a, b) => a.scheduledStartAt - b.scheduledStartAt)[0] ?? null;

        return {
          id: cleaner._id,
          name: cleaner.name ?? cleaner.email,
          email: cleaner.email,
          todayJobCount,
          currentJob,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const membership = await getLatestActiveMembership(ctx, currentUser._id);
    const company = membership ? await ctx.db.get(membership.companyId) : null;

    return {
      stats: {
        totalJobs: managerJobs.length,
        unassigned: managerJobs.filter(
          (job) => job.assignedCleanerIds.length === 0,
        ).length,
        inProgress: managerJobs.filter((job) => job.status === "in_progress").length,
        completed: managerJobs.filter((job) => job.status === "completed").length,
        awaitingApproval: managerJobs.filter(
          (job) => job.status === "awaiting_approval",
        ).length,
      },
      cleaners: cleanersWithStats,
      company: company ? { id: company._id, name: company.name } : null,
    };
  },
});

export const getCleaners = query({
  args: {},
  handler: async (ctx) => {
    const currentUser = await requireRole(ctx, ["manager", "property_ops", "admin"]);

    const allCleaners = await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "cleaner"))
      .collect();

    let cleaners = allCleaners;

    if (currentUser.role !== "admin") {
      const membership = await getLatestActiveMembership(ctx, currentUser._id);
      if (membership) {
        const companyMembers = await ctx.db
          .query("companyMembers")
          .withIndex("by_company", (q) => q.eq("companyId", membership.companyId))
          .collect();

        const activeCleanerIds = new Set(
          companyMembers
            .filter(
              (member) =>
                member.isActive &&
                member.leftAt === undefined &&
                member.role === "cleaner",
            )
            .map((member) => member.userId),
        );

        cleaners = allCleaners.filter((cleaner) => activeCleanerIds.has(cleaner._id));
      }
    }

    return cleaners
      .map((cleaner) => ({
        ...cleaner,
        id: cleaner._id,
      }))
      .sort((a, b) => {
        const nameA = a.name ?? a.email;
        const nameB = b.name ?? b.email;
        return nameA.localeCompare(nameB);
      });
  },
});

export const getOpsDashboard = query({
  args: {},
  handler: async (ctx) => {
    const currentUser = await requireRole(ctx, ["property_ops", "admin"]);
    const now = Date.now();
    const nextWeek = now + 7 * 24 * 60 * 60 * 1000;

    let propertyIds: Id<"properties">[] = [];

    if (currentUser.role !== "admin") {
      const assignments = await ctx.db
        .query("propertyOpsAssignments")
        .withIndex("by_user", (q) => q.eq("userId", currentUser._id))
        .collect();
      propertyIds = assignments.map((assignment) => assignment.propertyId);
    }

    const propertyIdSet = new Set(propertyIds);

    const allJobsRaw = await ctx.db.query("cleaningJobs").collect();
    const allJobs =
      currentUser.role === "admin"
        ? allJobsRaw
        : allJobsRaw.filter((job) => propertyIdSet.has(job.propertyId));

    const staysRaw = await ctx.db.query("stays").collect();
    const relevantStays =
      currentUser.role === "admin"
        ? staysRaw
        : staysRaw.filter((stay) => propertyIdSet.has(stay.propertyId));

    const upcomingCheckins = relevantStays
      .filter((stay) => stay.checkInAt >= now && stay.checkInAt <= nextWeek)
      .sort((a, b) => a.checkInAt - b.checkInAt)
      .slice(0, 10);

    const alerts = allJobs
      .filter(
        (job) =>
          job.status !== "completed" &&
          job.status !== "cancelled" &&
          (job.isUrgent || job.partyRiskFlag || job.opsRiskFlag),
      )
      .sort((a, b) => b.scheduledStartAt - a.scheduledStartAt)
      .slice(0, 20);

    return {
      stats: {
        totalJobs: allJobs.length,
        inProgress: allJobs.filter((job) => job.status === "in_progress").length,
        awaitingApproval: allJobs.filter((job) => job.status === "awaiting_approval")
          .length,
        completed: allJobs.filter((job) => job.status === "completed").length,
      },
      upcomingCheckins,
      alerts,
      allJobs: allJobs.sort((a, b) => b.scheduledStartAt - a.scheduledStartAt),
    };
  },
});
