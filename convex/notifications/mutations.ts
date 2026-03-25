import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

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
