// convex/guestReviews/mutations.ts
import { v } from "convex/values";
import { mutation, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { requireRole } from "../lib/auth";
import { assertTransition, InvalidReviewTransitionError } from "./statusMachine";

/** Skip a review that doesn't need a reply (e.g. a glowing 5-star review). */
export const dismiss = mutation({
  args: { reviewId: v.id("guestReviews") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin", "property_ops"]);

    const review = await ctx.db.get(args.reviewId);
    if (!review) throw new Error("Review not found.");

    assertTransition(review.status, "dismissed");
    await ctx.db.patch(args.reviewId, { status: "dismissed" });
    return null;
  },
});

/**
 * Approve the (possibly edited) draft and publish it. Flips status to
 * "sending" atomically in this mutation — a concurrent second click sees
 * status !== "drafted" and throws InvalidReviewTransitionError, which the
 * UI treats as a no-op ("someone already sent this"). The actual Hospitable
 * API call happens in the scheduled action, not here, because mutations
 * cannot make outbound network calls.
 */
export const approveAndSend = mutation({
  args: { reviewId: v.id("guestReviews"), responseText: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["admin", "property_ops"]);

    const trimmed = args.responseText.trim();
    if (!trimmed) throw new Error("Response text cannot be empty.");

    const review = await ctx.db.get(args.reviewId);
    if (!review) throw new Error("Review not found.");

    assertTransition(review.status, "sending");
    await ctx.db.patch(args.reviewId, {
      status: "sending",
      respondedText: trimmed,
      respondedBy: user._id,
      sendError: undefined,
    });

    await ctx.scheduler.runAfter(0, internal.guestReviews.actions.sendApprovedReply, {
      reviewId: args.reviewId,
    });

    return null;
  },
});

/**
 * Retry a failed send — re-enters "sending" and re-schedules the action.
 * Takes the (possibly edited) response text from the caller so a fix made
 * in the UI before retrying is actually what gets sent, rather than
 * silently resending the original failed text still stored on the row.
 */
export const retrySend = mutation({
  args: { reviewId: v.id("guestReviews"), responseText: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin", "property_ops"]);

    const trimmed = args.responseText.trim();
    if (!trimmed) throw new Error("Response text cannot be empty.");

    const review = await ctx.db.get(args.reviewId);
    if (!review) throw new Error("Review not found.");

    assertTransition(review.status, "sending");
    await ctx.db.patch(args.reviewId, {
      status: "sending",
      respondedText: trimmed,
      sendError: undefined,
    });

    await ctx.scheduler.runAfter(0, internal.guestReviews.actions.sendApprovedReply, {
      reviewId: args.reviewId,
    });

    return null;
  },
});

/** Called by sendApprovedReply on a successful Hospitable API response. */
export const markSent = internalMutation({
  args: { reviewId: v.id("guestReviews"), respondedAt: v.number() },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review) return;
    assertTransition(review.status, "sent");
    await ctx.db.patch(args.reviewId, { status: "sent", respondedAt: args.respondedAt });
  },
});

/** Called by sendApprovedReply when the Hospitable API call fails. */
export const markSendFailed = internalMutation({
  args: { reviewId: v.id("guestReviews"), error: v.string() },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review) return;
    assertTransition(review.status, "send_failed");
    await ctx.db.patch(args.reviewId, { status: "send_failed", sendError: args.error });
  },
});

export const saveDraft = internalMutation({
  args: { reviewId: v.id("guestReviews"), draftText: v.string() },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review) return;
    assertTransition(review.status, "drafted");
    await ctx.db.patch(args.reviewId, {
      status: "drafted",
      aiDraftText: args.draftText,
      aiDraftGeneratedAt: Date.now(),
    });
  },
});

export { InvalidReviewTransitionError };
