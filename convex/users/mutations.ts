import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser, requireAuth } from "../lib/auth";

const roleValidator = v.union(
  v.literal("cleaner"),
  v.literal("manager"),
  v.literal("property_ops"),
  v.literal("admin"),
);

const themeValidator = v.union(v.literal("dark"), v.literal("light"));

export const ensureUser = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    role: v.optional(roleValidator),
    avatarUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireAuth(ctx);
    const now = Date.now();

    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .first();

    if (existingUser) {
      await ctx.db.patch(existingUser._id, {
        name: args.name,
        email: args.email,
        role: args.role ?? existingUser.role,
        avatarUrl: args.avatarUrl ?? existingUser.avatarUrl,
        updatedAt: now,
      });
      return { userId: existingUser._id };
    }

    const userId = await ctx.db.insert("users", {
      clerkId: identity.subject,
      email: args.email,
      name: args.name,
      role: args.role ?? "cleaner",
      avatarUrl: args.avatarUrl,
      createdAt: now,
      updatedAt: now,
    });

    return { userId };
  },
});

export const updateMyProfile = mutation({
  args: {
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    pushToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    await ctx.db.patch(user._id, {
      ...args,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

export const markNotificationRead = mutation({
  args: {
    id: v.id("notifications"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    const notification = await ctx.db.get(args.id);
    if (!notification || notification.userId !== user._id) {
      throw new Error("Notification not found");
    }

    await ctx.db.patch(args.id, {
      readAt: Date.now(),
    });

    return { success: true };
  },
});

export const markAllNotificationsRead = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);

    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) => q.eq(q.field("readAt"), undefined))
      .collect();

    const now = Date.now();
    await Promise.all(
      unread.map((notification) =>
        ctx.db.patch(notification._id, {
          readAt: now,
        })
      )
    );

    return { success: true, count: unread.length };
  },
});

export const dismissNotification = mutation({
  args: {
    id: v.id("notifications"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    const notification = await ctx.db.get(args.id);
    if (!notification || notification.userId !== user._id) {
      throw new Error("Notification not found");
    }

    await ctx.db.patch(args.id, {
      dismissedAt: Date.now(),
    });

    return { success: true };
  },
});

export const setThemePreference = mutation({
  args: {
    theme: themeValidator,
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const existingMetadata =
      user.metadata && typeof user.metadata === "object" && !Array.isArray(user.metadata)
        ? (user.metadata as Record<string, unknown>)
        : {};

    await ctx.db.patch(user._id, {
      metadata: {
        ...existingMetadata,
        theme: args.theme,
      },
      updatedAt: Date.now(),
    });

    return { success: true, theme: args.theme };
  },
});
