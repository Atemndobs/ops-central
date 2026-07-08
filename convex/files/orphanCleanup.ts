"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { deleteExternalObject } from "../lib/externalStorage";

/**
 * Explicit shapes for the action's runQuery / runMutation calls. These
 * break a TS inference cycle between the action and the internal
 * query/mutation it dispatches to (the action's return type would
 * otherwise depend on its own bundled types). See TS7022 / TS7023.
 */
type OrphanedTicket = {
  ticketId: Id<"pendingMediaUploads">;
  provider: string;
  bucket: string;
  objectKey: string;
  posterObjectKey?: string;
  mediaKind: "image" | "video";
  expiresAt: number;
};

type SweepResult = {
  cutoffTs: number;
  ticketsScanned: number;
  objectsDeleted: number;
  ticketsAbandoned: number;
  ticketsPurged: number;
  errors: string[];
  dryRun: boolean;
};

/**
 * Orphan cleanup for the video-support feature.
 *
 * Every external upload ticket (image OR video) is tracked in the
 * `pendingMediaUploads` table. When `completeExternalUpload` runs the row
 * is marked `"completed"`. If the client never finalises (network drop,
 * tab close mid-upload, app crash after PUT but before mutation), the row
 * stays `"pending"` past `expiresAt`.
 *
 * This action runs daily via cron (`convex/crons.ts`):
 *
 *   1. Lists `pending` tickets whose `expiresAt < now - GRACE_HOURS`.
 *   2. Best-effort deletes the bucket objects (primary + poster for video).
 *   3. Marks the ticket row `"abandoned"` with any error.
 *   4. Garbage-collects `completed` rows older than the long retention
 *      window so the table doesn't grow forever.
 *
 * Failure modes:
 *   - Bucket-side delete fails → row stays `"pending"`-with-error; next
 *     run retries. (Unlimited retries; the cost of a stranded object is
 *     low and B2 lifecycle policies cap exposure further.)
 *   - Race: a `completeExternalUpload` lands while we're cleaning up →
 *     the row flips to `"completed"` before our `markAbandoned` query
 *     runs, and the next read sees `"completed"`; we no-op via the
 *     `if (!ticket) return` check inside `markTicketAbandoned`. The
 *     bucket object is gone but the photo row points at a 404 — a known
 *     small risk we accept (the grace window makes this extremely rare).
 *
 * See Phase 1 of Docs/video-support/IMPLEMENTATION-PLAN.md.
 */

const HOUR_MS = 60 * 60 * 1000;

/** Time after expiresAt before a ticket is considered orphaned and swept. */
const ORPHAN_GRACE_HOURS = 24;

/** Time after which `completed` ticket rows are purged from the table. */
const COMPLETED_RETENTION_HOURS = 24 * 7; // 7 days

/** Cap per-run to keep the action well within Convex action time limits. */
const DEFAULT_BATCH_SIZE = 100;

export const sweepOrphans = internalAction({
  args: {
    /** Override grace period — useful for backfill or testing. */
    graceHours: v.optional(v.number()),
    /** Max tickets to process per run. */
    batchSize: v.optional(v.number()),
    /** When true, only logs would-be deletes; no bucket or DB mutations. */
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<SweepResult> => {
    const graceHours = Math.max(1, Math.floor(args.graceHours ?? ORPHAN_GRACE_HOURS));
    const batchSize = Math.max(
      1,
      Math.min(500, Math.floor(args.batchSize ?? DEFAULT_BATCH_SIZE)),
    );
    const dryRun = args.dryRun === true;

    const cutoffTs = Date.now() - graceHours * HOUR_MS;

    const tickets: OrphanedTicket[] = await ctx.runQuery(
      internal.files.orphanCleanupState.listOrphanedTickets,
      { cutoffTs, limit: batchSize },
    );

    let deletedObjects = 0;
    let abandonedTickets = 0;
    const errors: string[] = [];

    for (const ticket of tickets) {
      if (dryRun) {
        console.log(
          `[orphanCleanup] DRY RUN — would delete ${ticket.objectKey}` +
            (ticket.posterObjectKey ? ` + ${ticket.posterObjectKey}` : ""),
        );
        continue;
      }

      // Best-effort delete primary object.
      let primaryError: string | undefined;
      try {
        await deleteExternalObject({
          bucket: ticket.bucket,
          objectKey: ticket.objectKey,
        });
        deletedObjects++;
      } catch (err) {
        primaryError = err instanceof Error ? err.message : String(err);
      }

      // Best-effort delete poster (video only).
      let posterError: string | undefined;
      if (ticket.posterObjectKey) {
        try {
          await deleteExternalObject({
            bucket: ticket.bucket,
            objectKey: ticket.posterObjectKey,
          });
          deletedObjects++;
        } catch (err) {
          posterError = err instanceof Error ? err.message : String(err);
        }
      }

      const combinedError = [primaryError, posterError]
        .filter(Boolean)
        .join(" | ")
        .slice(0, 500);

      try {
        await ctx.runMutation(
          internal.files.orphanCleanupState.markTicketAbandoned,
          {
            ticketId: ticket.ticketId,
            error: combinedError || undefined,
          },
        );
        abandonedTickets++;
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    // Garbage-collect old completed tickets.
    let purged = 0;
    if (!dryRun) {
      const purgeCutoff = Date.now() - COMPLETED_RETENTION_HOURS * HOUR_MS;
      try {
        purged = await ctx.runMutation(
          internal.files.orphanCleanupState.purgeStaleTickets,
          { olderThanTs: purgeCutoff, limit: batchSize },
        );
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    return {
      cutoffTs,
      ticketsScanned: tickets.length,
      objectsDeleted: deletedObjects,
      ticketsAbandoned: abandonedTickets,
      ticketsPurged: purged,
      errors,
      dryRun,
    };
  },
});
