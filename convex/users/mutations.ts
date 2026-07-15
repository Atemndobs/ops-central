import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser, requireAuth } from "../lib/auth";
import {
  readProfileOverrides,
  setProfileOverride,
} from "../lib/profileMetadata";
import { MAX_AVATAR_URL_BYTES, sanitizeAvatarUrl } from "../lib/avatarUrl";
import { internal } from "../_generated/api";

const roleValidator = v.union(
  v.literal("cleaner"),
  v.literal("manager"),
  v.literal("property_ops"),
  v.literal("admin"),
  v.literal("owner"),
);

const themeValidator = v.union(v.literal("dark"), v.literal("light"));
const localeValidator = v.union(v.literal("en"), v.literal("es"));
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
    // Runs on every session (see clerk-user-sync.tsx) — a bad avatar must never
    // block sign-in, so drop it silently rather than throwing.
    const normalizedAvatarUrl = sanitizeAvatarUrl(args.avatarUrl);

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

      if (!profileOverrides.avatarUrl && normalizedAvatarUrl !== undefined) {
        updates.avatarUrl = normalizedAvatarUrl;
      }

      await ctx.db.patch(existingUser._id, {
        ...updates,
      });
      return { userId: existingUser._id };
    }

    const role = args.role ?? "cleaner";
    // Role-based locale defaults: cleaners => es, ops/admin => en
    const defaultLocale = role === "cleaner" ? "es" : "en";

    const userId = await ctx.db.insert("users", {
      clerkId: identity.subject,
      email: args.email,
      name: args.name,
      role,
      avatarUrl: normalizedAvatarUrl,
      preferredLocale: defaultLocale,
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
      if (args.avatarUrl.trim().length === 0) {
        throw new Error("Avatar URL cannot be empty.");
      }
      // The caller supplied this directly, so tell them why it bounced rather
      // than silently storing nothing.
      const normalizedAvatarUrl = sanitizeAvatarUrl(args.avatarUrl);
      if (normalizedAvatarUrl === undefined) {
        throw new Error(
          "Avatar URL must be a link, not an embedded image, and under " +
            `${MAX_AVATAR_URL_BYTES} characters.`,
        );
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

export const setLocalePreference = mutation({
  args: {
    locale: localeValidator,
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    await ctx.db.patch(user._id, {
      preferredLocale: args.locale,
      updatedAt: Date.now(),
    });

    // Sync locale preference back to Clerk in the background
    await ctx.scheduler.runAfter(0, internal.clerk.actions.syncLocalePreferenceToClerk, {
      clerkId: user.clerkId,
      locale: args.locale,
    });

    return { success: true, locale: args.locale };
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
