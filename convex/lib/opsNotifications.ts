import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";

type OpsNotificationType = Doc<"notifications">["type"];

function isOpsRole(role: Doc<"users">["role"]): boolean {
  return role === "admin" || role === "property_ops" || role === "manager";
}

export async function createNotificationsForUsers(
  ctx: MutationCtx,
  args: {
    userIds: Id<"users">[];
    type: OpsNotificationType;
    title: string;
    message: string;
    data?: Record<string, unknown>;
  },
) {
  const recipientIds = [...new Set(args.userIds)];

  if (recipientIds.length === 0) {
    return { count: 0, notificationIds: [] as Id<"notifications">[] };
  }

  const now = Date.now();
  const notificationIds = await Promise.all(
    recipientIds.map(async (userId) => {
      const notificationId = await ctx.db.insert("notifications", {
        userId,
        type: args.type,
        title: args.title,
        message: args.message,
        data: args.data,
        pushSent: false,
        createdAt: now,
      });

      await ctx.scheduler.runAfter(
        0,
        internal.notifications.actions.sendPushForNotificationInternal,
        { notificationId },
      );

      return notificationId;
    }),
  );

  return { count: recipientIds.length, notificationIds };
}

export async function createOpsNotifications(
  ctx: MutationCtx,
  args: {
    type: OpsNotificationType;
    title: string;
    message: string;
    data?: Record<string, unknown>;
  },
) {
  const users = await ctx.db.query("users").collect();
  const recipientIds = users
    .filter((user) => isOpsRole(user.role))
    .map((user) => user._id);

  return await createNotificationsForUsers(ctx, {
    userIds: recipientIds,
    ...args,
  });
}
