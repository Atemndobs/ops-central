import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

type NotificationType = Doc<"notifications">["type"];
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getNotificationJobId(notification: Doc<"notifications">): string | null {
  if (!isRecord(notification.data)) {
    return null;
  }

  const jobId = notification.data.jobId;
  return typeof jobId === "string" && jobId.length > 0 ? jobId : null;
}

export async function listOpsUserIds(ctx: MutationCtx): Promise<Id<"users">[]> {
  const [admins, managers, propertyOps] = await Promise.all([
    ctx.db.query("users").withIndex("by_role", (q) => q.eq("role", "admin")).collect(),
    ctx.db.query("users").withIndex("by_role", (q) => q.eq("role", "manager")).collect(),
    ctx.db.query("users").withIndex("by_role", (q) => q.eq("role", "property_ops")).collect(),
  ]);

  return [...admins, ...managers, ...propertyOps].map((user) => user._id);
}

export async function dismissNotificationsForJob(ctx: MutationCtx, args: {
  jobId: string;
  userIds: Id<"users">[];
  types: NotificationType[];
}) {
  const targetUserIds = [...new Set(args.userIds)];
  const targetTypes = new Set<NotificationType>(args.types);

  if (targetUserIds.length === 0 || targetTypes.size === 0) {
    return { count: 0, notificationIds: [] as Id<"notifications">[] };
  }

  // Bandwidth: scope to undismissed only via `by_user_and_dismissed`. A
  // cleaner with months of history can have hundreds of dismissed
  // notifications; without this scoping, every job-status change reads them
  // all just to find the few still-active ones to dismiss. Wave 4 — see
  // Docs/2026-04-28-convex-bandwidth-optimization-plan.md.
  const notificationsByUser = await Promise.all(
    targetUserIds.map((userId) =>
      ctx.db
        .query("notifications")
        .withIndex("by_user_and_dismissed", (q) =>
          q.eq("userId", userId).eq("dismissedAt", undefined),
        )
        .collect(),
    ),
  );

  const matches = notificationsByUser
    .flat()
    .filter(
      (notification) =>
        targetTypes.has(notification.type) &&
        getNotificationJobId(notification) === args.jobId,
    );

  if (matches.length === 0) {
    return { count: 0, notificationIds: [] as Id<"notifications">[] };
  }

  const now = Date.now();
  await Promise.all(
    matches.map((notification) =>
      ctx.db.patch(notification._id, {
        readAt: notification.readAt ?? now,
        dismissedAt: now,
      }),
    ),
  );

  return {
    count: matches.length,
    notificationIds: matches.map((notification) => notification._id),
  };
}
