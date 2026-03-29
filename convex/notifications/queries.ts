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
    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("readAt"), undefined))
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
    let queryBuilder = ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc");

    if (!args.includeRead) {
      queryBuilder = queryBuilder.filter((q) => q.eq(q.field("readAt"), undefined));
    }

    const limit = args.limit ?? 50;
    return await queryBuilder.take(limit);
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

    const all = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(200);

    const filtered = all.filter((notification) => {
      if (notification.dismissedAt !== undefined) {
        return false;
      }
      if (args.includeRead) {
        return true;
      }
      return notification.readAt === undefined;
    });

    return filtered.slice(0, limit);
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
