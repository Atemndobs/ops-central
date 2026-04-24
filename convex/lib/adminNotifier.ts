/**
 * Admin notifier — debounced notifications to all users with role="admin".
 *
 * Writes to the existing `notifications` table (type="system") so the existing
 * in-app notification UI and push plumbing pick it up automatically.
 *
 * Debounce strategy: caller supplies `data.dedupeKey` (e.g.
 * `${quotaId}:${threshold}:${dayBucket}`). If a notification with a matching
 * dedupeKey already exists within the last 1 hour, the new one is skipped.
 *
 * This is an INTERNAL helper — not exposed as a Convex function. Call it from
 * mutations/actions via the normal module import.
 *
 * See Docs/usage-tracking/ADR.md §"Notifications".
 */

import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

const DEBOUNCE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export interface NotifyAdminsInput {
  title: string;
  message: string;
  /**
   * Arbitrary structured payload. MUST include `dedupeKey: string` for the
   * 1-hour debounce to apply. Events without a dedupeKey are always sent.
   */
  data?: Record<string, unknown> & { dedupeKey?: string };
}

export interface NotifyAdminsResult {
  /** How many admin notifications were inserted. 0 if deduped. */
  count: number;
  deduped: boolean;
  notificationIds: Id<"notifications">[];
}

/**
 * Fan out a system notification to every admin. Returns early (deduped:true,
 * count:0) if the dedupeKey has been seen in the last hour.
 */
export async function notifyAdmins(
  ctx: MutationCtx,
  input: NotifyAdminsInput,
): Promise<NotifyAdminsResult> {
  const now = Date.now();
  const dedupeKey = input.data?.dedupeKey;

  // Debounce — if a recent notification has the same dedupeKey, skip.
  // We scan by index("by_type") bounded to the debounce window to keep this
  // read small (system notifications are low-volume).
  if (dedupeKey) {
    const recent = await ctx.db
      .query("notifications")
      .withIndex("by_type", (q) => q.eq("type", "system"))
      .order("desc")
      .take(200);

    const cutoff = now - DEBOUNCE_WINDOW_MS;
    for (const n of recent) {
      if (n.createdAt < cutoff) break;
      const existingKey = (n.data as { dedupeKey?: string } | undefined)
        ?.dedupeKey;
      if (existingKey && existingKey === dedupeKey) {
        return { count: 0, deduped: true, notificationIds: [] };
      }
    }
  }

  // Find all admin users (indexed).
  const admins = await ctx.db
    .query("users")
    .withIndex("by_role", (q) => q.eq("role", "admin"))
    .collect();

  if (admins.length === 0) {
    return { count: 0, deduped: false, notificationIds: [] };
  }

  const notificationIds: Id<"notifications">[] = [];
  for (const admin of admins) {
    const id = await ctx.db.insert("notifications", {
      userId: admin._id,
      type: "system",
      title: input.title,
      message: input.message,
      data: input.data,
      pushSent: false,
      createdAt: now,
    });
    notificationIds.push(id);
  }

  return { count: notificationIds.length, deduped: false, notificationIds };
}
