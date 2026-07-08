/**
 * Authorization helpers for opsTasks and handover.
 *
 * Two distinct gates:
 * - requireOpsRole(ctx)         — admin / property_ops / manager only.
 *                                 Used for: create / update / assign / delete /
 *                                 all handover mutations.
 * - requireTaskActor(ctx, id)   — assignee may also act, but only for status
 *                                 updates, comments, and photo attaches.
 *                                 This is how cleaners participate without
 *                                 getting create/edit power.
 *
 * The full permissions matrix lives in
 *   Docs/ops-tasks-and-handover/architecture.md §2 (Authorization).
 */

import type { Id, Doc } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import { getCurrentUser, requireRole } from "./auth";

export const OPS_ROLES = ["admin", "property_ops", "manager"] as const;
export type OpsRole = (typeof OPS_ROLES)[number];

/**
 * Require the caller to be an ops user (admin / property_ops / manager).
 * Returns the full user document.
 */
export async function requireOpsRole(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users">> {
  return requireRole(ctx, [...OPS_ROLES]);
}

/**
 * Permit either an ops user OR the task's assignee. Used for status changes,
 * comments, and photo attachments — operations that cleaners may perform on
 * tasks assigned to them.
 *
 * Throws if the caller is neither.
 */
export async function requireTaskActor(
  ctx: QueryCtx | MutationCtx,
  taskId: Id<"opsTasks">,
): Promise<{ user: Doc<"users">; task: Doc<"opsTasks">; isOps: boolean }> {
  const user = await getCurrentUser(ctx);
  const task = await ctx.db.get(taskId);
  if (!task) {
    throw new Error("Task not found");
  }

  const isOps = (OPS_ROLES as readonly string[]).includes(user.role);
  const isAssignee = task.assigneeId === user._id;

  if (!isOps && !isAssignee) {
    throw new Error(
      "Insufficient permissions: only ops staff or the task's assignee may act on this task.",
    );
  }

  return { user, task, isOps };
}

/**
 * Visibility gate for queries. Ops users see all tasks; cleaners see only
 * tasks assigned to them. Returns the user and a predicate suitable for
 * `.filter` or post-fetch trimming.
 */
export async function getTaskVisibility(
  ctx: QueryCtx | MutationCtx,
): Promise<{
  user: Doc<"users">;
  isOps: boolean;
  canSee: (task: Doc<"opsTasks">) => boolean;
}> {
  const user = await getCurrentUser(ctx);
  const isOps = (OPS_ROLES as readonly string[]).includes(user.role);
  return {
    user,
    isOps,
    canSee: (task: Doc<"opsTasks">) =>
      isOps || task.assigneeId === user._id,
  };
}
