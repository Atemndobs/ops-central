import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

const TRANSLATE_LANG = v.union(v.literal("en"), v.literal("es"));

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
