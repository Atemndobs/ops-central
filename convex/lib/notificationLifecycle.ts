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

  const notificationsByUser = await Promise.all(
    targetUserIds.map((userId) =>
      ctx.db.query("notifications").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
    ),
  );

  const matches = notificationsByUser
    .flat()
    .filter(
      (notification) =>
        notification.dismissedAt === undefined &&
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
