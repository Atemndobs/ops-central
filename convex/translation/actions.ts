"use node";

import { action, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { ConvexError, v } from "convex/values";
import { translateText, translateTitleBody } from "../lib/translation";

const TRANSLATE_LANG = v.union(v.literal("en"), v.literal("es"));

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
  handler: async (_ctx, args) => {
    if (args.sourceLang === args.targetLang) return args.text;
    try {
      return await translateText(args.text, args.sourceLang, args.targetLang);
    } catch (error) {
      throw new ConvexError(
        error instanceof Error ? error.message : "Translation failed.",
      );
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
    try {
      const translated = await translateTitleBody(
        { title: args.title, body: args.body },
        args.sourceLang,
        args.targetLang,
      );
      await ctx.runMutation(internal.translation.internal.setInstructionTranslation, {
        propertyId: args.propertyId,
        instructionId: args.instructionId,
        lang: args.targetLang,
        title: translated.title,
        body: translated.body,
      });
    } catch (error) {
      // Soft-fail: cleaner UI falls back to source text.
      console.error("translateInstruction failed:", error);
    }
  },
});
