import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { upsertSingleReservation } from "./mutations";
import { normalizeReservation } from "./actions";
import { normalizeGuestReview } from "../guestReviews/normalize";

// Event names per Hospitable v2 webhooks help doc. The SDK README uses
// "reservation.updated" while the help doc uses "reservation.changed" — we
// accept both defensively.
const RESERVATION_EVENT_ACTIONS = new Set([
  "reservation.created",
  "reservation.changed",
  "reservation.updated",
]);

const REVIEW_EVENT_ACTIONS = new Set(["review.created"]);

const RECEIVE_OUTCOME = {
  processed: "processed",
  duplicate: "duplicate",
  ignoredAction: "ignored_action",
  normalizationFailed: "normalization_failed",
} as const;

type ReceiveOutcome = (typeof RECEIVE_OUTCOME)[keyof typeof RECEIVE_OUTCOME];

/**
 * Idempotent ingest of a single Hospitable webhook delivery.
 *
 * Hospitable retries each delivery up to 5 times (1s, 5s, 10s, 1h, 6h). We
 * insert into `hospitableWebhookEvents` keyed by `hospitableEventId`; on
 * conflict we short-circuit and return `duplicate` so retries never
 * double-write.
 *
 * For reservation events we run the normalizer (which already handles the
 * Hospitable payload shape) and call `upsertSingleReservation` — the same
 * helper the hourly cron uses. Non-reservation events are recorded for
 * observability but produce no side effects in Phase 0.
 *
 * The mutation never throws on processing failures: errors are persisted on
 * the row (`processingError`) so the webhook route can still return 200 and
 * Hospitable doesn't burn retries on our bugs. Signature failures and
 * malformed payloads are the route's responsibility.
 */
export const ingestEvent = mutation({
  args: {
    secret: v.string(),
    hospitableEventId: v.string(),
    action: v.string(),
    receivedAt: v.number(),
    rawPayload: v.any(),
    // Log-only observation while we discover the real signature header.
    signatureValid: v.optional(v.boolean()),
    signatureHeaders: v.optional(v.any()),
  },
  handler: async (ctx, args): Promise<{ outcome: ReceiveOutcome; eventDocId: string }> => {
    const sharedSecret = process.env.HOSPITABLE_WEBHOOK_SECRET;
    if (!sharedSecret || args.secret !== sharedSecret) {
      throw new Error("Unauthorized: invalid Hospitable webhook ingest secret.");
    }

    const existing = await ctx.db
      .query("hospitableWebhookEvents")
      .withIndex("by_event_id", (q) =>
        q.eq("hospitableEventId", args.hospitableEventId)
      )
      .first();

    if (existing) {
      return { outcome: RECEIVE_OUTCOME.duplicate, eventDocId: existing._id };
    }

    const eventDocId = await ctx.db.insert("hospitableWebhookEvents", {
      hospitableEventId: args.hospitableEventId,
      action: args.action,
      receivedAt: args.receivedAt,
      rawPayload: args.rawPayload,
      signatureValid: args.signatureValid,
      signatureHeaders: args.signatureHeaders,
    });

    if (RESERVATION_EVENT_ACTIONS.has(args.action)) {
      const rawReservation = (args.rawPayload as { data?: unknown })?.data;
      const { reservation, error } = normalizeReservation(rawReservation, "");

      if (!reservation) {
        await ctx.db.patch(eventDocId, {
          processedAt: Date.now(),
          processingError: error ?? "Failed to normalize reservation payload.",
        });
        return { outcome: RECEIVE_OUTCOME.normalizationFailed, eventDocId };
      }

      try {
        await upsertSingleReservation(ctx, {
          reservation,
          syncedAt: args.receivedAt,
        });
        await ctx.db.patch(eventDocId, { processedAt: Date.now() });
      } catch (err) {
        await ctx.db.patch(eventDocId, {
          processedAt: Date.now(),
          processingError: err instanceof Error ? err.message : String(err),
        });
      }

      return { outcome: RECEIVE_OUTCOME.processed, eventDocId };
    }

    if (REVIEW_EVENT_ACTIONS.has(args.action)) {
      const rawReview = (args.rawPayload as { data?: unknown })?.data;
      const { review, error } = normalizeGuestReview(rawReview);

      if (!review) {
        await ctx.db.patch(eventDocId, {
          processedAt: Date.now(),
          processingError: error ?? "Failed to normalize review payload.",
        });
        return { outcome: RECEIVE_OUTCOME.normalizationFailed, eventDocId };
      }

      try {
        await ctx.runMutation(internal.hospitable.mutations.upsertGuestReview, review);
        await ctx.db.patch(eventDocId, { processedAt: Date.now() });
      } catch (err) {
        await ctx.db.patch(eventDocId, {
          processedAt: Date.now(),
          processingError: err instanceof Error ? err.message : String(err),
        });
      }

      return { outcome: RECEIVE_OUTCOME.processed, eventDocId };
    }

    await ctx.db.patch(eventDocId, { processedAt: Date.now() });
    return { outcome: RECEIVE_OUTCOME.ignoredAction, eventDocId };
  },
});
