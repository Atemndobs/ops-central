"use node";

import { action, internalAction } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { ConvexError, v } from "convex/values";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import {
  translateText,
  translateTitleBody,
  TranslationError,
} from "../lib/translation";

const TRANSLATE_LANG = v.union(v.literal("en"), v.literal("es"));

type TranslateStatus =
  | "success"
  | "rate_limited"
  | "quota_exceeded"
  | "auth_error"
  | "client_error"
  | "server_error"
  | "timeout"
  | "unknown_error";

/**
 * Classify a thrown error into a normalized `serviceUsageEvents.status`. The
 * `TranslationError.message` wraps the raw Gemini response string so we can
 * grep for HTTP status markers we know about.
 */
function classifyTranslationError(error: unknown): {
  status: TranslateStatus;
  errorCode?: string;
  errorMessage: string;
} {
  const message =
    error instanceof Error ? error.message : String(error ?? "unknown");
  const match = /returned (\d{3})/i.exec(message);
  const code = match ? match[1] : undefined;

  let status: TranslateStatus = "unknown_error";
  if (code) {
    const num = Number(code);
    if (num === 401 || num === 403) status = "auth_error";
    else if (num === 429) status = "rate_limited";
    else if (num === 402) status = "quota_exceeded";
    else if (num >= 400 && num < 500) status = "client_error";
    else if (num >= 500) status = "server_error";
  } else if (/network|fetch/i.test(message)) {
    status = "timeout";
  } else if (/blocked the prompt/i.test(message)) {
    status = "client_error";
  }

  return {
    status,
    errorCode: code,
    errorMessage: message.slice(0, 500),
  };
}

/**
 * Fire-and-log wrapper: runs `translateText` and records one
 * `serviceUsageEvents` row per call. The logger is best-effort — a failed
 * insert never bubbles. Returns the translated text (or rethrows the
 * underlying TranslationError so callers keep their existing fallback
 * behaviour).
 */
async function runAndLogTranslation(
  ctx: ActionCtx,
  args: {
    text: string;
    sourceLang: "en" | "es";
    targetLang: "en" | "es";
    feature: string;
    userId?: Id<"users">;
    metadata?: Record<string, unknown>;
  },
): Promise<string> {
  const startedAt = Date.now();
  try {
    const result = await translateText(
      args.text,
      args.sourceLang,
      args.targetLang,
    );
    const durationMs = Date.now() - startedAt;
    try {
      await ctx.runMutation(internal.serviceUsage.logger.log, {
        serviceKey: "gemini",
        feature: args.feature,
        status: "success",
        userId: args.userId,
        durationMs,
        // Approximate tokens from character count. A real count arrives
        // only on the paid tier; for free-tier visibility the proxy is
        // good enough for quota tracking.
        inputTokens: Math.round(args.text.length / 4),
        outputTokens: Math.round(result.length / 4),
        metadata: {
          model: process.env.GEMINI_TRANSLATION_MODEL ?? "gemini-2.5-flash",
          sourceLang: args.sourceLang,
          targetLang: args.targetLang,
          ...args.metadata,
        },
      });
    } catch {
      // best-effort — never let logging failures affect the caller
    }
    return result;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const classified = classifyTranslationError(error);
    try {
      await ctx.runMutation(internal.serviceUsage.logger.log, {
        serviceKey: "gemini",
        feature: args.feature,
        status: classified.status,
        userId: args.userId,
        durationMs,
        inputTokens: Math.round(args.text.length / 4),
        errorCode: classified.errorCode,
        errorMessage: classified.errorMessage,
        metadata: {
          model: process.env.GEMINI_TRANSLATION_MODEL ?? "gemini-2.5-flash",
          sourceLang: args.sourceLang,
          targetLang: args.targetLang,
          ...args.metadata,
        },
      });
    } catch {
      // best-effort
    }
    throw error;
  }
}

async function resolveUserId(
  ctx: ActionCtx,
): Promise<Id<"users"> | undefined> {
  try {
    const row = await ctx.runQuery(api.users.queries.getMyProfile, {});
    if (row && typeof row === "object" && "_id" in row) {
      return (row as { _id: Id<"users"> })._id;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Translate a free-form string. Used by the admin "Auto-translate" button
 * and (later) by message translation.
 */
export const translate = action({
  args: {
    text: v.string(),
    sourceLang: TRANSLATE_LANG,
    targetLang: TRANSLATE_LANG,
  },
  handler: async (ctx, args): Promise<string> => {
    if (args.sourceLang === args.targetLang) return args.text;
    const userId = await resolveUserId(ctx);
    try {
      return await runAndLogTranslation(ctx, {
        text: args.text,
        sourceLang: args.sourceLang,
        targetLang: args.targetLang,
        feature: "translation_adhoc",
        userId,
      });
    } catch (error) {
      throw new ConvexError(
        error instanceof Error ? error.message : "Translation failed.",
      );
    }
  },
});

/**
 * Translate a single conversation message into the requested locale and
 * cache the result. Called lazily by clients when a viewer's locale
 * differs from the message's sourceLang and the cache is empty.
 *
 * Idempotent: if the translation is already cached, this is a no-op and
 * still returns the cached text.
 */
export const translateMessage = action({
  args: {
    messageId: v.id("conversationMessages"),
    targetLang: TRANSLATE_LANG,
  },
  handler: async (ctx, args): Promise<string | null> => {
    const message = await ctx.runQuery(
      internal.translation.internal.getMessageForTranslation,
      { messageId: args.messageId },
    );
    if (!message) return null;

    const sourceLang = (message.sourceLang ?? "en") as "en" | "es";
    if (sourceLang === args.targetLang) return message.body;

    const cached = message.translations?.[args.targetLang];
    if (cached) return cached;

    const userId = await resolveUserId(ctx);
    try {
      const translated = await runAndLogTranslation(ctx, {
        text: message.body,
        sourceLang,
        targetLang: args.targetLang,
        feature: "translation_message",
        userId,
        metadata: { messageId: args.messageId },
      });
      await ctx.runMutation(
        internal.translation.internal.setMessageTranslation,
        {
          messageId: args.messageId,
          lang: args.targetLang,
          body: translated,
        },
      );
      return translated;
    } catch (error) {
      console.error("translateMessage failed:", error);
      return null;
    }
  },
});

/**
 * Translate one property instruction (title + body) and persist the result
 * into instructions[*].translations[targetLang]. Scheduled by addInstruction
 * / updateInstruction mutations after every source edit.
 *
 * Safe to re-run — overwrites the cached translation each time.
 */
export const translateInstruction = internalAction({
  args: {
    propertyId: v.id("properties"),
    instructionId: v.string(),
    sourceLang: TRANSLATE_LANG,
    targetLang: TRANSLATE_LANG,
    title: v.string(),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.sourceLang === args.targetLang) return;
    const startedAt = Date.now();
    try {
      const translated = await translateTitleBody(
        { title: args.title, body: args.body },
        args.sourceLang,
        args.targetLang,
      );
      const durationMs = Date.now() - startedAt;
      await ctx.runMutation(
        internal.translation.internal.setInstructionTranslation,
        {
          propertyId: args.propertyId,
          instructionId: args.instructionId,
          lang: args.targetLang,
          title: translated.title,
          body: translated.body,
        },
      );
      try {
        await ctx.runMutation(internal.serviceUsage.logger.log, {
          serviceKey: "gemini",
          feature: "translation_instruction",
          status: "success",
          durationMs,
          inputTokens: Math.round(
            (args.title.length + args.body.length) / 4,
          ),
          outputTokens: Math.round(
            (translated.title.length + translated.body.length) / 4,
          ),
          metadata: {
            model: process.env.GEMINI_TRANSLATION_MODEL ?? "gemini-2.5-flash",
            sourceLang: args.sourceLang,
            targetLang: args.targetLang,
            propertyId: args.propertyId,
            instructionId: args.instructionId,
          },
        });
      } catch {
        // best-effort
      }
    } catch (error) {
      // Soft-fail: cleaner UI falls back to source text.
      console.error("translateInstruction failed:", error);
      const classified = classifyTranslationError(error);
      try {
        await ctx.runMutation(internal.serviceUsage.logger.log, {
          serviceKey: "gemini",
          feature: "translation_instruction",
          status: classified.status,
          durationMs: Date.now() - startedAt,
          inputTokens: Math.round(
            (args.title.length + args.body.length) / 4,
          ),
          errorCode: classified.errorCode,
          errorMessage: classified.errorMessage,
          metadata: {
            model: process.env.GEMINI_TRANSLATION_MODEL ?? "gemini-2.5-flash",
            sourceLang: args.sourceLang,
            targetLang: args.targetLang,
            propertyId: args.propertyId,
            instructionId: args.instructionId,
          },
        });
      } catch {
        // best-effort
      }
    }
  },
});

// Keep the re-exported helper reachable from other modules that expect it.
export { TranslationError };
