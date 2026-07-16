import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { listOpsUserIds } from "./notificationLifecycle";

type OpsNotificationType = Doc<"notifications">["type"];

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
  const DEDUP_WINDOW_MS = 60 * 60 * 1000; // 1 hour
  const jobId = args.data?.jobId as string | undefined;

  const results = await Promise.all(
    recipientIds.map(async (userId) => {
      // Dedup: skip if this user already has a notification of the same type
      // for the same job within the last hour. Uses by_user_and_type index
      // (bounded read on userId + type + createdAt range).
      if (jobId !== undefined) {
        const recent = await ctx.db
          .query("notifications")
          .withIndex("by_user_and_type", (q) =>
            q
              .eq("userId", userId)
              .eq("type", args.type)
              .gte("createdAt", now - DEDUP_WINDOW_MS),
          )
          .filter((q) => q.eq(q.field("data.jobId"), jobId))
          .first();
        if (recent !== null) return null;
      }

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

  const notificationIds = results.filter(
    (id): id is Id<"notifications"> => id !== null,
  );
  return { count: notificationIds.length, notificationIds };
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
  // Read-cost: this previously did `ctx.db.query("users").collect()` — a FULL
  // TABLE SCAN of `users` — and then discarded everyone who wasn't ops. It runs
  // on the hottest write paths in the backend (job create/update/approve/
  // acknowledge, refills, job checks), so EVERY one of those writes scanned the
  // entire users table. `listOpsUserIds` returns the same set (admin +
  // property_ops + manager) via three `by_role` indexed reads.
  const recipientIds = await listOpsUserIds(ctx);

  return await createNotificationsForUsers(ctx, {
    userIds: recipientIds,
    ...args,
  });
}
