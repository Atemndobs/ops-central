// convex/guestReviews/actions.ts
import { v } from "convex/values";
import { action, internalAction } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import {
  draftReviewResponse,
  refineOutreachMessage,
  refineReviewResponse,
  ReviewResponseDraftError,
} from "../lib/reviewResponseDraft";
import {
  getReservationMessages,
  postReservationMessage,
  postReviewResponse,
} from "../hospitable/actions";
import type { ReservationMessage } from "../hospitable/reservationMessages";

const DEFAULT_HOSPITABLE_BASE_URL = "https://public.api.hospitable.com/v2";

async function loadReservationHistory(
  ctx: ActionCtx,
  stay: Doc<"stays"> | null,
): Promise<ReservationMessage[]> {
  if (!stay?.hospitableId) return [];
  const apiKey = process.env.HOSPITABLE_API_KEY ?? process.env.HOSPITABLE_API_TOKEN;
  if (!apiKey) throw new ConvexError("Hospitable API credentials are not configured.");
  const baseUrl = process.env.HOSPITABLE_API_URL ?? DEFAULT_HOSPITABLE_BASE_URL;
  return getReservationMessages({
    apiKey,
    baseUrl,
    reservationId: stay.hospitableId,
    ctx,
  });
}

async function loadReservationHistoryForDraft(
  ctx: ActionCtx,
  stay: Doc<"stays"> | null,
): Promise<ReservationMessage[]> {
  try {
    return await loadReservationHistory(ctx, stay);
  } catch (error) {
    console.warn("Could not load Hospitable history for review drafting", {
      stayId: stay?._id,
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

const reservationMessageValidator = v.object({
  id: v.string(),
  senderRole: v.union(v.literal("guest"), v.literal("host"), v.literal("system")),
  body: v.string(),
  createdAt: v.number(),
  platform: v.optional(v.string()),
  attachments: v.array(v.string()),
});

interface ReviewStayHistory {
  linked: boolean;
  reason?: string;
  stay?: {
    checkInAt: number;
    checkOutAt: number;
    guestName: string;
    confirmationCode?: string;
    platform?: string;
  };
  messages: ReservationMessage[];
}

export const getReviewStayHistory = action({
  args: { reviewId: v.id("guestReviews") },
  returns: v.object({
    linked: v.boolean(),
    reason: v.optional(v.string()),
    stay: v.optional(v.object({
      checkInAt: v.number(),
      checkOutAt: v.number(),
      guestName: v.string(),
      confirmationCode: v.optional(v.string()),
      platform: v.optional(v.string()),
    })),
    messages: v.array(reservationMessageValidator),
  }),
  handler: async (ctx, args): Promise<ReviewStayHistory> => {
    await ctx.runQuery(internal.guestReviews.internalQueries.assertReviewManagerAccess, {});
    const review = await ctx.runQuery(internal.guestReviews.internalQueries.getById, {
      reviewId: args.reviewId,
    });
    if (!review) throw new ConvexError("Review not found.");

    const stay = await ctx.runQuery(internal.guestReviews.internalQueries.getLinkedStay, {
      propertyId: review.propertyId,
      reviewedAt: review.reviewedAt,
      guestFirstName: review.guestFirstName,
      guestLastName: review.guestLastName,
      hospitableReservationId: review.hospitableReservationId,
    });
    if (!stay) {
      return { linked: false, reason: "No matching stay was found.", messages: [] };
    }

    const staySummary = {
      checkInAt: stay.checkInAt,
      checkOutAt: stay.checkOutAt,
      guestName: stay.guestName,
      ...(stay.confirmationCode ? { confirmationCode: stay.confirmationCode } : {}),
      ...(stay.platform ? { platform: stay.platform } : {}),
    };
    if (!stay.hospitableId) {
      return {
        linked: false,
        reason: "The stay is not linked to a Hospitable reservation.",
        stay: staySummary,
        messages: [],
      };
    }

    return {
      linked: true,
      stay: staySummary,
      messages: await loadReservationHistory(ctx, stay),
    };
  },
});

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

export const refineOutreachDraft = action({
  args: {
    stayId: v.id("stays"),
    currentDraft: v.string(),
    instruction: v.optional(v.string()),
    provider: v.union(v.literal("gemini"), v.literal("claude"), v.literal("openai")),
    incentive: INCENTIVE_VALUES,
    tone: v.string(),
    length: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const context = await ctx.runQuery(internal.stays.queries.getOutreachContext, {
      stayId: args.stayId,
    });
    if (!context) throw new ConvexError("Stay not found.");

    try {
      return await refineOutreachMessage({
        guestName: context.guestName,
        propertyName: context.propertyName,
        stayCheckIn: context.checkInAt,
        stayCheckOut: context.checkOutAt,
        currentDraft: args.currentDraft,
        provider: args.provider,
        incentive: args.incentive,
        tone: args.tone,
        length: args.length,
        instruction: args.instruction,
      });
    } catch (error) {
      throw new ConvexError(
        error instanceof ReviewResponseDraftError ? error.message : String(error),
      );
    }
  },
});

export const sendOutreachMessage = action({
  args: {
    stayId: v.id("stays"),
    message: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const context = await ctx.runQuery(internal.stays.queries.getOutreachContext, {
      stayId: args.stayId,
    });
    if (!context) throw new ConvexError("Stay not found.");
    if (!context.hospitableId) {
      throw new ConvexError("This stay is not linked to a Hospitable reservation.");
    }

    const message = args.message.trim();
    if (!message) throw new ConvexError("Message cannot be empty.");
    if (message.length > 4000) throw new ConvexError("Message is too long.");

    const apiKey = process.env.HOSPITABLE_API_KEY ?? process.env.HOSPITABLE_API_TOKEN;
    if (!apiKey) {
      throw new ConvexError(
        "Missing HOSPITABLE_API_KEY/HOSPITABLE_API_TOKEN environment variable.",
      );
    }
    const baseUrl = process.env.HOSPITABLE_API_URL ?? DEFAULT_HOSPITABLE_BASE_URL;

    try {
      await postReservationMessage({
        apiKey,
        baseUrl,
        reservationId: context.hospitableId,
        message,
        ctx,
      });
      return null;
    } catch (error) {
      throw new ConvexError(error instanceof Error ? error.message : String(error));
    }
  },
});

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
      guestFirstName: review.guestFirstName,
      guestLastName: review.guestLastName,
      hospitableReservationId: review.hospitableReservationId,
    });

    const reservationMessages = await loadReservationHistoryForDraft(ctx, stay);

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
          `Use the following pre-written building blocks for structure and tone, ` +
          `assemble them into a single fluent, natural response. ` +
          (args.tone ? `Tone: ${args.tone}. ` : "") +
          (args.length === "short" ? "Keep the reply SHORT — 2 to 3 sentences maximum. " :
           args.length === "detailed" ? "Write a DETAILED reply — 5 or more sentences. " :
           "Keep the reply STANDARD length — 3 to 5 sentences. ") +
          `Use the stay conversation as the source of truth for factual details. ` +
          `For a negative review, mention a specific correction only when the conversation shows it happened; ` +
          `otherwise say the concern is being reviewed. Never expose private guest details.\n\n${blocks}` +
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
        reservationMessages,
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

    const stay = await ctx.runQuery(internal.guestReviews.internalQueries.getLinkedStay, {
      propertyId: review.propertyId,
      reviewedAt: review.reviewedAt,
      guestFirstName: review.guestFirstName,
      guestLastName: review.guestLastName,
      hospitableReservationId: review.hospitableReservationId,
    });

    try {
      const reservationMessages = await loadReservationHistoryForDraft(ctx, stay);
      const draftText = await draftReviewResponse({
        rating: review.rating,
        publicReview: review.publicReview,
        guestFirstName: review.guestFirstName,
        propertyName: property?.name ?? "the property",
        reservationMessages,
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
