import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";

type OpsNotificationType = Doc<"notifications">["type"];

function isOpsRole(role: Doc<"users">["role"]): boolean {
  return role === "admin" || role === "property_ops" || role === "manager";
}

/**
 * Param values for `messageParams`. Strings and numbers are the only types
 * worth interpolating into a translation template — anything else is a code
 * smell (objects/arrays should be flattened by the caller). `boolean` is
 * deliberately excluded; if you need it, stringify it first.
 *
 * `messageParams` itself is `v.any()` in the schema, so this is a TypeScript-
 * only guard. See Docs/2026-05-21-notification-message-i18n-design.md §5.
 */
export type NotificationMessageParams = Record<string, string | number>;

export async function createNotificationsForUsers(
  ctx: MutationCtx,
  args: {
    userIds: Id<"users">[];
    type: OpsNotificationType;
    title: string;
    message: string;
    /**
     * i18n key under `notifications.messages.*`. When present, clients render
     * `t(messageKey, messageParams)`; otherwise they fall back to `message`.
     */
    messageKey?: string;
    /** Params passed to the client's `t()` for interpolation. */
    messageParams?: NotificationMessageParams;
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
        messageKey: args.messageKey,
        messageParams: args.messageParams,
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
    messageKey?: string;
    messageParams?: NotificationMessageParams;
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
