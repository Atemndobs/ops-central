// Convex Notification Queries
// Internal queries used by notification actions

import { v } from "convex/values";
import { query, internalQuery } from "../_generated/server";
import { Doc } from "../_generated/dataModel";
import { getCurrentUser } from "../lib/auth";

/**
 * Get a user by ID (internal)
 */
export const getUserById = internalQuery({
  args: {
    id: v.id("users"),
  },
  handler: async (ctx, args): Promise<Doc<"users"> | null> => {
    return await ctx.db.get(args.id);
  },
});

/**
 * Get users by role (internal)
 */
export const getUsersByRole = internalQuery({
  args: {
    role: v.union(
      v.literal("cleaner"),
      v.literal("manager"),
      v.literal("property_ops"),
      v.literal("admin")
    ),
  },
  handler: async (ctx, args): Promise<Doc<"users">[]> => {
    return await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", args.role))
      .collect();
  },
});

/**
 * Get unread notification count for a user (internal)
 */
export const getUnreadCount = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args): Promise<number> => {
    // Read-cost: this was `by_user` + `.filter(readAt === undefined)` + `.collect()`
    // — the `.filter()` does not bound reads, so it scanned the user's ENTIRE
    // notification history just to produce one integer, and the cost grew with
    // account age forever. `by_unread` ([userId, readAt]) bounds the read to the
    // unread rows themselves.
    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_unread", (q) =>
        q.eq("userId", args.userId).eq("readAt", undefined),
      )
      .collect();

    return notifications.length;
  },
});

/**
 * Get user's notifications (public query)
 */
export const getUserNotifications = query({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
    includeRead: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // SECURITY (IDOR): this was a public query taking `userId` with NO auth check
    // whatsoever — any authenticated client could read ANY other user's
    // notifications just by passing their id. Notifications are strictly
    // personal, so fail closed to self-only. Both existing callers
    // (layout/header.tsx and settings/settings-page-client.tsx) already pass
    // their own `convexUser._id`, so this is a no-op for them. Returning [] rather
    // than throwing matches the codebase idiom (cleaningJobs.getForCleaner) and
    // avoids crashing a reactive subscription.
    const user = await getCurrentUser(ctx);
    if (user._id !== args.userId) {
      return [];
    }

    const limit = args.limit ?? 50;

    if (!args.includeRead) {
      // Read-cost: this was `by_user` + `.filter(readAt === undefined)`. A
      // `.filter()` after `.withIndex()` does NOT bound the read — it scans
      // forward until it collects `limit` matches, so a user with 3,000 read and
      // 2 unread notifications scanned 3,002 docs to return 2. Worst case is
      // unbounded. `by_unread` ([userId, readAt]) matches this exactly — it was
      // defined in the schema and never used anywhere.
      return await ctx.db
        .query("notifications")
        .withIndex("by_unread", (q) =>
          q.eq("userId", args.userId).eq("readAt", undefined),
        )
        .order("desc")
        .take(limit);
    }

    return await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(limit);
  },
});

/**
 * Get authenticated user's notifications (cleaner/mobile-safe contract)
 */
export const getMyNotifications = query({
  args: {
    limit: v.optional(v.number()),
    includeRead: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const limit =
      typeof args.limit === "number" && Number.isFinite(args.limit)
        ? Math.max(1, Math.min(100, Math.floor(args.limit)))
        : 50;

    // Read-cost: this used `by_user .order("desc").take(200)` and then dropped
    // dismissed/read rows in JS before slicing to `limit` (<=100, default 50) —
    // a hard 4x over-read on the most-mounted notification query (4 cleaner-app
    // mounts: cleaner-shell, cleaner-home-client, cleaner-notifications-client,
    // cleaner-settings-client), re-running on every notification write for that
    // user. Both predicates have a matching index that was going unused.
    if (args.includeRead) {
      // `dismissedAt === undefined` is then the ONLY predicate, and
      // `by_user_and_dismissed` matches it exactly — so `take(limit)` now reads
      // precisely what we return, nothing more.
      return await ctx.db
        .query("notifications")
        .withIndex("by_user_and_dismissed", (q) =>
          q.eq("userId", user._id).eq("dismissedAt", undefined),
        )
        .order("desc")
        .take(limit);
    }

    // Unread-only: bound on `by_unread` ([userId, readAt]) and drop dismissed in
    // memory. No composite index covers unread AND undismissed together, but the
    // unread set is inherently small, so this reads the unread rows rather than
    // the user's whole history. Keep the 200 cushion the old code used so a run
    // of dismissed-but-unread rows can't starve the result.
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_unread", (q) =>
        q.eq("userId", user._id).eq("readAt", undefined),
      )
      .order("desc")
      .take(200);

    return unread
      .filter((notification) => notification.dismissedAt === undefined)
      .slice(0, limit);
  },
});

/**
 * Get notification by ID
 */
export const getNotificationById = query({
  args: {
    id: v.id("notifications"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/**
 * Get notification by ID (internal)
 */
export const getNotificationByIdInternal = internalQuery({
  args: {
    id: v.id("notifications"),
  },
  handler: async (ctx, args): Promise<Doc<"notifications"> | null> => {
    return await ctx.db.get(args.id);
  },
});

/**
 * Get pending notification schedules (internal)
 */
export const getPendingSchedules = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const limit = args.limit ?? 100;

    return await ctx.db
      .query("notificationSchedules")
      .withIndex("by_pending", (q) =>
        q.eq("status", "pending").lt("scheduledFor", now)
      )
      .take(limit);
  },
});

/**
 * Get notification schedule by ID (internal)
 */
export const getScheduleById = internalQuery({
  args: {
    id: v.id("notificationSchedules"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/**
 * Get cleaning job with property info (internal)
 * Used for building notification content
 */
export const getJobWithProperty = internalQuery({
  args: {
    jobId: v.id("cleaningJobs"),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;

    const property = await ctx.db.get(job.propertyId);

    return {
      ...job,
      property,
    };
  },
});

/**
 * Get all active cleaners (internal)
 * Used for notifying cleaners about new jobs
 */
export const getActiveCleaners = internalQuery({
  handler: async (ctx): Promise<Doc<"users">[]> => {
    return await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "cleaner"))
      .collect();
  },
});

/**
 * Get user by Clerk ID (internal)
 */
export const getUserByClerkId = internalQuery({
  args: {
    clerkId: v.string(),
  },
  handler: async (ctx, args): Promise<Doc<"users"> | null> => {
    return await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .first();
  },
});
