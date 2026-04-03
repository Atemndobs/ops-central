import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

type OpsNotificationType = Doc<"notifications">["type"];

function isOpsRole(role: Doc<"users">["role"]): boolean {
  return role === "admin" || role === "property_ops" || role === "manager";
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
  const recipientIds = [...new Set(
    users
      .filter((user) => isOpsRole(user.role))
      .map((user) => user._id),
  )] as Id<"users">[];

  if (recipientIds.length === 0) {
    return { count: 0 };
  }

  const now = Date.now();
  await Promise.all(
    recipientIds.map((userId) =>
      ctx.db.insert("notifications", {
        userId,
        type: args.type,
        title: args.title,
        message: args.message,
        data: args.data,
        pushSent: false,
        createdAt: now,
      }),
    ),
  );

  return { count: recipientIds.length };
}
