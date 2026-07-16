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
 * "sending" atomically in this mutation. A concurrent second click sees
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
 * Retry a failed send: re-enters "sending" and re-schedules the action.
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

/**
 * One-off backfill: fill every respondable review with a deterministic,
 * ready-to-send prepared response assembled from the seeded
 * reviewResponseTemplates (NO AI call). Category is derived from the star
 * rating; incentive follows the agreed policy:
 *   5★ → ask for a Google review (grow off-Airbnb reputation)
 *   4★ / 3★ → 10% return-stay discount (win them back)
 *   ≤2★ → sincere professional apology, no sales pitch
 * Placeholders ([GUEST_NAME], [PROPERTY_NAME]) are substituted with the real
 * guest first name + property name before saving. Nothing is auto-sent; each
 * row stays in "drafted" for a human to approve or tweak. Safe to re-run.
 */
type Category = "glowing_5star" | "positive_4star" | "mixed_3star" | "critical_2star";
type Incentive = "none" | "return_discount" | "google_review" | "early_late_checkin";

function policyFor(rating: number): { category: Category; incentive: Incentive } {
  if (rating >= 5) return { category: "glowing_5star", incentive: "google_review" };
  if (rating === 4) return { category: "positive_4star", incentive: "return_discount" };
  if (rating === 3) return { category: "mixed_3star", incentive: "return_discount" };
  return { category: "critical_2star", incentive: "none" };
}

export const backfillPreparedDrafts = internalMutation({
  args: { overwrite: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const overwrite = args.overwrite ?? true;

    // Config table (16 rows, R1-exempt). Key by category:incentive.
    const templates = await ctx.db.query("reviewResponseTemplates").collect();
    const tByKey = new Map(templates.map((t) => [`${t.reviewCategory}:${t.incentive}`, t]));

    // Only the pending-response statuses; each read is index-bounded (by_status).
    const statuses = ["drafted", "needs_draft", "send_failed"] as const;
    const rows = (
      await Promise.all(
        statuses.map((s) =>
          ctx.db
            .query("guestReviews")
            .withIndex("by_status", (q) => q.eq("status", s))
            .collect(),
        ),
      )
    ).flat();

    const propNameCache = new Map<string, string>();
    let filled = 0;
    let skippedNoTemplate = 0;
    let skippedCannotRespond = 0;

    for (const review of rows) {
      if (!review.canRespond) {
        skippedCannotRespond++;
        continue;
      }
      if (!overwrite && review.aiDraftText && review.aiDraftText.trim()) continue;

      const { category, incentive } = policyFor(review.rating);
      const t = tByKey.get(`${category}:${incentive}`);
      if (!t) {
        skippedNoTemplate++;
        continue;
      }

      let propName = propNameCache.get(review.propertyId as string);
      if (propName === undefined) {
        const prop = await ctx.db.get(review.propertyId);
        propName = prop?.name ?? "our place";
        propNameCache.set(review.propertyId as string, propName);
      }

      const guestName = review.guestFirstName?.trim() || "there";
      const sub = (s: string) =>
        s.replace(/\[GUEST_NAME\]/g, guestName).replace(/\[PROPERTY_NAME\]/g, propName);

      const body = [t.opener, t.acknowledgment, t.addressIssue, t.inviteBack, t.incentiveText]
        .filter((b): b is string => Boolean(b && b.trim()))
        .map(sub)
        .join(" ");
      const draftText = `${body}\n\n${sub(t.closer)}`;

      await ctx.db.patch(review._id, {
        aiDraftText: draftText,
        aiDraftGeneratedAt: Date.now(),
        status: review.status === "needs_draft" ? "drafted" : review.status,
      });
      filled++;
    }

    return { filled, skippedNoTemplate, skippedCannotRespond, scanned: rows.length };
  },
});

export { InvalidReviewTransitionError };
