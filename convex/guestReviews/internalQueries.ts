// convex/guestReviews/internalQueries.ts
import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { requireRole } from "../lib/auth";

export const getById = internalQuery({
  args: { reviewId: v.id("guestReviews") },
  handler: async (ctx, args) => ctx.db.get(args.reviewId),
});

export const getPropertyName = internalQuery({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args) => ctx.db.get(args.propertyId),
});

export const assertReviewManagerAccess = internalQuery({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["admin", "property_ops"]);
    return null;
  },
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
    hospitableReservationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.hospitableReservationId) {
      const exact = await ctx.db
        .query("stays")
        .withIndex("by_hospitable", (q) =>
          q.eq("hospitableId", args.hospitableReservationId),
        )
        .first();
      if (exact) return exact;
    }

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
    if (candidates.length > 0) {
      return candidates.sort((a, b) => b.checkOutAt - a.checkOutAt)[0];
    }

    // Airbnb sometimes masks the reviewer as the literal "Guest". In that
    // case the nearest checkout is the best available fallback until the
    // reservation id is populated by the next Hospitable review sync.
    const nearby = stays.filter(
      (s) =>
        s.checkOutAt <= args.reviewedAt &&
        s.checkOutAt >= args.reviewedAt - thirtyDaysMs,
    );
    return nearby.sort((a, b) => b.checkOutAt - a.checkOutAt)[0] ?? null;
  },
});
