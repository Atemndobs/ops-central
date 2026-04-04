import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

function normalizeMetadata(metadata: unknown): Record<string, unknown> {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>;
  }

  return {};
}

export const markPushDelivery = internalMutation({
  args: {
    notificationId: v.id("notifications"),
    sent: v.boolean(),
  },
  handler: async (ctx, args) => {
    const notification = await ctx.db.get(args.notificationId);
    if (!notification) {
      return { updated: false };
    }

    if (args.sent) {
      await ctx.db.patch(args.notificationId, {
        pushSent: true,
        pushSentAt: Date.now(),
      });
    } else {
      await ctx.db.patch(args.notificationId, {
        pushSent: false,
      });
    }

    return { updated: true };
  },
});

export const clearUserWebPushSubscription = internalMutation({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      return { updated: false };
    }

    const metadata = normalizeMetadata(user.metadata);
    if (!("webPushSubscription" in metadata)) {
      return { updated: false };
    }

    const rest = { ...metadata };
    delete rest.webPushSubscription;

    await ctx.db.patch(args.userId, {
      metadata: rest,
      updatedAt: Date.now(),
    });

    return { updated: true };
  },
});
