import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

const TRANSLATE_LANG = v.union(v.literal("en"), v.literal("es"));

/**
 * Read a single message's source + cached translation. Internal so only the
 * translation action can use it (no public message reads via id).
 */
export const getMessageForTranslation = internalQuery({
  args: { messageId: v.id("conversationMessages") },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message) return null;
    return {
      _id: message._id,
      body: message.body,
      sourceLang: message.sourceLang,
      translations: message.translations,
    };
  },
});

/**
 * Patch a single message's translations[lang]. Idempotent; safe to re-run.
 */
export const setMessageTranslation = internalMutation({
  args: {
    messageId: v.id("conversationMessages"),
    lang: TRANSLATE_LANG,
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message) return;
    const existing = message.translations ?? {};
    await ctx.db.patch(args.messageId, {
      translations: { ...existing, [args.lang]: args.body },
    });
  },
});

/**
 * Patch a single instruction's translations[lang]. Idempotent: callers can
 * re-run safely; later writes overwrite earlier ones.
 */
export const setInstructionTranslation = internalMutation({
  args: {
    propertyId: v.id("properties"),
    instructionId: v.string(),
    lang: TRANSLATE_LANG,
    title: v.string(),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const property = await ctx.db.get(args.propertyId);
    if (!property || !property.isActive) return;

    const current = property.instructions ?? [];
    const index = current.findIndex((ins) => ins.id === args.instructionId);
    if (index === -1) return;

    const next = current.slice();
    const existing = current[index].translations ?? {};
    next[index] = {
      ...current[index],
      translations: {
        ...existing,
        [args.lang]: { title: args.title, body: args.body },
      },
    };

    await ctx.db.patch(args.propertyId, {
      instructions: next,
      updatedAt: Date.now(),
    });
  },
});
