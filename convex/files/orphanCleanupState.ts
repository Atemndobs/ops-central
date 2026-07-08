import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";

/**
 * Internal query/mutation helpers for the orphan-cleanup cron. Split from
 * the action so the action stays free to do network I/O and the
 * data-touching pieces stay in the regular query/mutation runtime.
 *
 * See `convex/files/orphanCleanup.ts` for the entry-point action and
 * Phase 1 of Docs/video-support/IMPLEMENTATION-PLAN.md for the design.
 */

/**
 * Find pending upload tickets whose grace period has elapsed and that the
 * client never finalised. Capped — caller batches.
 */
export const listOrphanedTickets = internalQuery({
  args: {
    /** Wall-clock cutoff. Tickets whose `expiresAt < cutoffTs` are eligible. */
    cutoffTs: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(500, Math.floor(args.limit)));
    const rows = await ctx.db
      .query("pendingMediaUploads")
      .withIndex("by_status_and_expiry", (q) =>
        q.eq("status", "pending").lte("expiresAt", args.cutoffTs),
      )
      .take(limit);

    return rows.map((row) => ({
      ticketId: row._id,
      provider: row.provider,
      bucket: row.bucket,
      objectKey: row.objectKey,
      posterObjectKey: row.posterObjectKey ?? undefined,
      mediaKind: row.mediaKind,
      expiresAt: row.expiresAt,
    }));
  },
});

/** Mark a ticket as cleaned up after the bucket-side delete succeeded. */
export const markTicketAbandoned = internalMutation({
  args: {
    ticketId: v.id("pendingMediaUploads"),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ticket = await ctx.db.get(args.ticketId);
    if (!ticket) return false;
    await ctx.db.patch(args.ticketId, {
      status: "abandoned",
      abandonedAt: Date.now(),
      lastCleanupError: args.error,
    });
    return true;
  },
});

/**
 * Permanently drop completed/abandoned ticket rows older than the given
 * cutoff. Keeps the table from growing forever. Audit history (the existence
 * of an abandoned ticket) is short-lived — the actual orphan delete is
 * already logged via `logServiceUsage` / `b2_delete`.
 */
export const purgeStaleTickets = internalMutation({
  args: {
    olderThanTs: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(1000, Math.floor(args.limit)));
    const rows = await ctx.db
      .query("pendingMediaUploads")
      .withIndex("by_status_and_expiry", (q) => q.eq("status", "completed"))
      .filter((q) => q.lte(q.field("expiresAt"), args.olderThanTs))
      .take(limit);

    let deleted = 0;
    for (const row of rows) {
      await ctx.db.delete(row._id);
      deleted++;
    }
    return deleted;
  },
});
