// convex/guestReviews/internalQueries.ts
import { v } from "convex/values";
import { internalQuery } from "../_generated/server";

export const getById = internalQuery({
  args: { reviewId: v.id("guestReviews") },
  handler: async (ctx, args) => ctx.db.get(args.reviewId),
});

export const getPropertyName = internalQuery({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args) => ctx.db.get(args.propertyId),
});

/** Find the stay most likely linked to a review (closest checkout before reviewedAt). */
export const getLinkedStay = internalQuery({
  args: { propertyId: v.id("properties"), reviewedAt: v.number() },
  handler: async (ctx, args) => {
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const stays = await ctx.db
      .query("stays")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();
    const candidates = stays.filter(
      (s) =>
        s.checkOutAt <= args.reviewedAt &&
        s.checkOutAt >= args.reviewedAt - thirtyDaysMs,
    );
    if (candidates.length === 0) return null;
    return candidates.sort((a, b) => b.checkOutAt - a.checkOutAt)[0];
  },
});
