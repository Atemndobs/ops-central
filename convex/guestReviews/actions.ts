// convex/guestReviews/actions.ts
import { v } from "convex/values";
import { action, internalAction } from "../_generated/server";
import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import {
  draftReviewResponse,
  refineReviewResponse,
  ReviewResponseDraftError,
} from "../lib/reviewResponseDraft";
import { postReviewResponse } from "../hospitable/actions";

const DEFAULT_HOSPITABLE_BASE_URL = "https://public.api.hospitable.com/v2";

/**
 * Client-callable action: regenerate or refine an AI draft using the
 * chosen provider (Gemini / Claude / OpenAI). Fetches rich context —
 * property details, linked stay dates, private feedback — so the prompt
 * has everything needed for a high-quality, specific reply.
 *
 * Returns the new draft text. The caller (ReviewCard) places it into the
 * editable textarea; the user can edit further before approving.
 */
const REVIEW_CATEGORY_VALUES = v.union(
  v.literal("glowing_5star"),
  v.literal("positive_4star"),
  v.literal("mixed_3star"),
  v.literal("critical_2star"),
);
const INCENTIVE_VALUES = v.union(
  v.literal("none"),
  v.literal("return_discount"),
  v.literal("google_review"),
  v.literal("early_late_checkin"),
);

export const refineReviewDraft = action({
  args: {
    reviewId: v.id("guestReviews"),
    currentDraft: v.string(),
    instruction: v.optional(v.string()),
    provider: v.union(v.literal("gemini"), v.literal("claude"), v.literal("openai")),
    // Template-based refinement (replaces free-text instruction when provided)
    reviewCategory: v.optional(REVIEW_CATEGORY_VALUES),
    incentive: v.optional(INCENTIVE_VALUES),
    tone: v.optional(v.string()),
    length: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated.");

    const review = await ctx.runQuery(internal.guestReviews.internalQueries.getById, {
      reviewId: args.reviewId,
    });
    if (!review) throw new ConvexError("Review not found.");

    const property = await ctx.runQuery(internal.guestReviews.internalQueries.getPropertyName, {
      propertyId: review.propertyId,
    });

    const stay = await ctx.runQuery(internal.guestReviews.internalQueries.getLinkedStay, {
      propertyId: review.propertyId,
      reviewedAt: review.reviewedAt,
    });

    const promptSettings = await ctx.runQuery(internal.appSettings.getReviewSystemPromptInternal, {});

    // Build a structured instruction from pre-written template blocks when
    // the caller sends category + incentive instead of a free-text instruction.
    let resolvedInstruction = args.instruction;
    if (args.reviewCategory && args.incentive) {
      const templates = await ctx.runQuery(internal.reviewTemplates.internalQueries.getByKey, {
        reviewCategory: args.reviewCategory,
        incentive: args.incentive,
      });
      if (templates) {
        const guestName = review.guestFirstName;
        const propName = property?.name ?? "the property";
        const sub = (s: string) =>
          s.replace(/\[GUEST_NAME\]/g, guestName).replace(/\[PROPERTY_NAME\]/g, propName);
        const blocks = [
          `Opener: "${sub(templates.opener)}"`,
          `Acknowledgment: "${sub(templates.acknowledgment)}"`,
          templates.addressIssue ? `Address issue: "${sub(templates.addressIssue)}"` : null,
          `Invite back: "${sub(templates.inviteBack)}"`,
          templates.incentiveText ? `Incentive offer: "${sub(templates.incentiveText)}"` : null,
          `Closer: "${sub(templates.closer)}"`,
        ].filter(Boolean).join("\n");
        resolvedInstruction =
          `Using ONLY the following pre-written building blocks as your source material, ` +
          `assemble them into a single fluent, natural response. ` +
          (args.tone ? `Tone: ${args.tone}. ` : "") +
          (args.length === "short" ? "Keep the reply SHORT — 2 to 3 sentences maximum. " :
           args.length === "detailed" ? "Write a DETAILED reply — 5 or more sentences. " :
           "Keep the reply STANDARD length — 3 to 5 sentences. ") +
          `Do not add new content beyond what is in the blocks.\n\n${blocks}` +
          (args.instruction ? `\n\nAdditional note from manager: ${args.instruction}` : "");
      }
    }

    try {
      return await refineReviewResponse({
        rating: review.rating,
        publicReview: review.publicReview,
        privateFeedback: review.privateFeedback,
        guestFirstName: review.guestFirstName,
        guestLastName: review.guestLastName,
        propertyName: property?.name ?? "the property",
        stayCheckIn: stay?.checkInAt,
        stayCheckOut: stay?.checkOutAt,
        totalAmount: stay?.totalAmount,
        currency: stay?.currency,
        currentDraft: args.currentDraft,
        instruction: resolvedInstruction,
        provider: args.provider,
        systemPromptOverride: promptSettings?.prompt ?? undefined,
      });
    } catch (error) {
      throw new ConvexError(
        error instanceof ReviewResponseDraftError ? error.message : String(error),
      );
    }
  },
});

/**
 * Generates an AI draft reply for a newly-ingested review. Triggered by
 * upsertGuestReview on first insert (status: "needs_draft"), and re-triggered
 * on every re-sync while a row remains stuck in "needs_draft" (see
 * upsertGuestReview's re-schedule branch in Task 5). On Gemini failure the
 * row is simply left untouched — it stays "needs_draft" for the next retry.
 */
export const generateDraft = internalAction({
  args: { reviewId: v.id("guestReviews") },
  handler: async (ctx, args): Promise<void> => {
    const review = await ctx.runQuery(internal.guestReviews.internalQueries.getById, {
      reviewId: args.reviewId,
    });
    if (!review || review.status !== "needs_draft") return;

    const property = await ctx.runQuery(internal.guestReviews.internalQueries.getPropertyName, {
      propertyId: review.propertyId,
    });

    try {
      const draftText = await draftReviewResponse({
        rating: review.rating,
        publicReview: review.publicReview,
        guestFirstName: review.guestFirstName,
        propertyName: property?.name ?? "the property",
      });

      await ctx.runMutation(internal.guestReviews.mutations.saveDraft, {
        reviewId: args.reviewId,
        draftText,
      });
    } catch (error) {
      const message =
        error instanceof ReviewResponseDraftError ? error.message : String(error);
      console.error("guestReviews.generateDraft failed", { reviewId: args.reviewId, message });
      // Row stays "needs_draft" — no state change, safe to leave for a
      // manual re-trigger or the next ingestion pass to retry.
    }
  },
});

/**
 * Publishes the approved (possibly edited) reply to Hospitable. Triggered
 * by approveAndSend / retrySend after they flip status to "sending".
 */
export const sendApprovedReply = internalAction({
  args: { reviewId: v.id("guestReviews") },
  handler: async (ctx, args): Promise<void> => {
    const review = await ctx.runQuery(internal.guestReviews.internalQueries.getById, {
      reviewId: args.reviewId,
    });
    if (!review || review.status !== "sending" || !review.respondedText) return;

    const apiKey = process.env.HOSPITABLE_API_KEY ?? process.env.HOSPITABLE_API_TOKEN;
    if (!apiKey) {
      await ctx.runMutation(internal.guestReviews.mutations.markSendFailed, {
        reviewId: args.reviewId,
        error: "Missing HOSPITABLE_API_KEY/HOSPITABLE_API_TOKEN environment variable.",
      });
      return;
    }
    const baseUrl = process.env.HOSPITABLE_API_URL ?? DEFAULT_HOSPITABLE_BASE_URL;

    try {
      const result = await postReviewResponse({
        apiKey,
        baseUrl,
        hospitableReviewId: review.hospitableReviewId,
        responseText: review.respondedText,
        ctx,
      });
      await ctx.runMutation(internal.guestReviews.mutations.markSent, {
        reviewId: args.reviewId,
        respondedAt: Date.parse(result.respondedAt) || Date.now(),
      });
    } catch (error) {
      await ctx.runMutation(internal.guestReviews.mutations.markSendFailed, {
        reviewId: args.reviewId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
});
