import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser, requireAuth } from "../lib/auth";
import {
  readProfileOverrides,
  setProfileOverride,
} from "../lib/profileMetadata";

const roleValidator = v.union(
  v.literal("cleaner"),
  v.literal("manager"),
  v.literal("property_ops"),
  v.literal("admin"),
);

const themeValidator = v.union(v.literal("dark"), v.literal("light"));
const webPushSubscriptionValidator = v.object({
  endpoint: v.string(),
  expirationTime: v.union(v.number(), v.null()),
  keys: v.object({
    auth: v.string(),
    p256dh: v.string(),
  }),
});

function normalizeMetadata(metadata: unknown): Record<string, unknown> {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>;
  }

  return {};
}

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
      const profileOverrides = readProfileOverrides(existingUser.metadata);
      const updates: {
        email: string;
        role: typeof existingUser.role;
        updatedAt: number;
        name?: string;
        avatarUrl?: string;
      } = {
        email: args.email,
        role: args.role ?? existingUser.role,
        updatedAt: now,
      };

      if (!profileOverrides.name && args.name) {
        updates.name = args.name;
      }

      if (!profileOverrides.avatarUrl && args.avatarUrl !== undefined) {
        updates.avatarUrl = args.avatarUrl;
      }

      await ctx.db.patch(existingUser._id, {
        ...updates,
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
    let nextMetadata = user.metadata;
    const updates: {
      updatedAt: number;
      metadata?: unknown;
      name?: string;
      phone?: string;
      avatarUrl?: string;
      pushToken?: string;
    } = {
      updatedAt: Date.now(),
    };

    if (args.name !== undefined) {
      const normalizedName = args.name.trim();
      if (normalizedName.length === 0) {
        throw new Error("Name cannot be empty.");
      }
      updates.name = normalizedName;
      nextMetadata = setProfileOverride(nextMetadata, "name", true);
    }

    if (args.phone !== undefined) {
      const normalizedPhone = args.phone.trim();
      updates.phone = normalizedPhone.length > 0 ? normalizedPhone : undefined;
    }

    if (args.avatarUrl !== undefined) {
      const normalizedAvatarUrl = args.avatarUrl.trim();
      if (normalizedAvatarUrl.length === 0) {
        throw new Error("Avatar URL cannot be empty.");
      }
      updates.avatarUrl = normalizedAvatarUrl;
      nextMetadata = setProfileOverride(nextMetadata, "avatarUrl", true);
    }

    if (args.pushToken !== undefined) {
      updates.pushToken = args.pushToken;
    }

    if (nextMetadata !== user.metadata) {
      updates.metadata = nextMetadata;
    }

    await ctx.db.patch(user._id, updates);

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

export const updateWebPushSubscription = mutation({
  args: {
    subscription: webPushSubscriptionValidator,
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const metadata = normalizeMetadata(user.metadata);

    await ctx.db.patch(user._id, {
      metadata: {
        ...metadata,
        webPushSubscription: args.subscription,
      },
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

export const clearWebPushSubscription = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    const metadata = normalizeMetadata(user.metadata);

    if (!("webPushSubscription" in metadata)) {
      return { success: true, cleared: false };
    }

    const rest = { ...metadata };
    delete rest.webPushSubscription;

    await ctx.db.patch(user._id, {
      metadata: rest,
      updatedAt: Date.now(),
    });

    return { success: true, cleared: true };
  },
});
