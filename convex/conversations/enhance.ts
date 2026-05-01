"use node";

// Action: polish a draft chat message via Gemini before the user sends.
//
// Auth-light: requires a signed-in user (so we can log usage against
// them). The provider is Gemini for now, mirroring the translation
// path; switching providers later is a one-line change in
// convex/lib/messageEnhance.ts.

import { ConvexError, v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  enhanceMessageDraft,
  MessageEnhanceError,
} from "../lib/messageEnhance";

const ENHANCE_LANG = v.union(v.literal("en"), v.literal("es"));

type EnhanceStatus =
  | "success"
  | "rate_limited"
  | "quota_exceeded"
  | "auth_error"
  | "client_error"
  | "server_error"
  | "timeout"
  | "unknown_error";

function classify(error: unknown): {
  status: EnhanceStatus;
  errorCode?: string;
  errorMessage: string;
} {
  const message =
    error instanceof Error ? error.message : String(error ?? "unknown");
  const match = /returned (\d{3})/i.exec(message);
  const code = match ? match[1] : undefined;

  let status: EnhanceStatus = "unknown_error";
  if (code) {
    const num = Number(code);
    if (num === 401 || num === 403) status = "auth_error";
    else if (num === 429) status = "rate_limited";
    else if (num === 402) status = "quota_exceeded";
    else if (num >= 400 && num < 500) status = "client_error";
    else if (num >= 500) status = "server_error";
  } else if (/network|fetch/i.test(message)) {
    status = "timeout";
  } else if (error instanceof MessageEnhanceError) {
    status = "client_error";
  }

  return { status, errorCode: code, errorMessage: message.slice(0, 500) };
}

export const enhanceDraft = action({
  args: {
    text: v.string(),
    locale: ENHANCE_LANG,
  },
  handler: async (ctx, args): Promise<string> => {
    const trimmed = args.text.trim();
    if (!trimmed) return "";
    if (trimmed.length > 4000) {
      throw new ConvexError("Draft is too long to enhance.");
    }

    // Best-effort user resolution for usage attribution.
    let userId: Id<"users"> | undefined;
    try {
      const row = await ctx.runQuery(api.users.queries.getMyProfile, {});
      if (row && typeof row === "object" && "_id" in row) {
        userId = (row as { _id: Id<"users"> })._id;
      }
    } catch {
      /* unauthenticated → leave undefined */
    }

    const startedAt = Date.now();
    try {
      const result = await enhanceMessageDraft(args.text, args.locale);
      const durationMs = Date.now() - startedAt;
      try {
        await ctx.runMutation(internal.serviceUsage.logger.log, {
          serviceKey: "gemini",
          feature: "message_enhance",
          status: "success",
          userId,
          durationMs,
          inputTokens: Math.round(args.text.length / 4),
          outputTokens: Math.round(result.length / 4),
          metadata: {
            model: process.env.GEMINI_ENHANCE_MODEL ?? "gemini-2.5-flash",
            locale: args.locale,
          },
        });
      } catch {
        /* best-effort */
      }
      return result;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const classified = classify(error);
      try {
        await ctx.runMutation(internal.serviceUsage.logger.log, {
          serviceKey: "gemini",
          feature: "message_enhance",
          status: classified.status,
          userId,
          durationMs,
          inputTokens: Math.round(args.text.length / 4),
          errorCode: classified.errorCode,
          errorMessage: classified.errorMessage,
          metadata: {
            model: process.env.GEMINI_ENHANCE_MODEL ?? "gemini-2.5-flash",
            locale: args.locale,
          },
        });
      } catch {
        /* best-effort */
      }
      throw new ConvexError(
        error instanceof Error ? error.message : "Could not enhance draft.",
      );
    }
  },
});
