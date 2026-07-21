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

function normalizeGuestName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Find the matching guest's stay with the closest checkout before reviewedAt. */
export const getLinkedStay = internalQuery({
  args: {
    propertyId: v.id("properties"),
    reviewedAt: v.number(),
    guestFirstName: v.string(),
    guestLastName: v.string(),
  },
  handler: async (ctx, args) => {
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const reviewGuest = normalizeGuestName(
      `${args.guestFirstName} ${args.guestLastName}`,
    );
    const stays = await ctx.db
      .query("stays")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .order("desc")
      .take(100);
    const candidates = stays.filter(
      (s) =>
        s.checkOutAt <= args.reviewedAt &&
        s.checkOutAt >= args.reviewedAt - thirtyDaysMs &&
        normalizeGuestName(s.guestName) === reviewGuest,
    );
    if (candidates.length === 0) return null;
    return candidates.sort((a, b) => b.checkOutAt - a.checkOutAt)[0];
  },
});
