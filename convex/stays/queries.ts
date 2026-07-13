import { v } from "convex/values";
import { query } from "../_generated/server";
import { getCurrentUser } from "../lib/auth";
import { getCallerJobScopeForListing } from "../lib/companyScope";

const GET_IN_RANGE_HARD_CAP = 500;

/**
 * Reservations overlapping a date window, across the caller's scoped
 * properties. Powers the schedule "Occupancy" view (Hospitable-style
 * reservation timeline).
 *
 * A stay overlaps [from, to) iff `checkInAt < to && checkOutAt > from`.
 * We index on `by_checkout` (checkOutAt > from) so past stays are excluded
 * up front, then filter `checkInAt < to` in memory.
 *
 * Fail-closed scoped like `cleaningJobs.getInDateRange`: managers only see
 * reservations for their own company's properties; admin/ops see all.
 * Cancelled stays are excluded (they don't occupy the calendar).
 */
export const getInDateRange = query({
  args: {
    from: v.number(),
    to: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    const allowedPropertyIds = await getCallerJobScopeForListing(ctx, user);
    if (allowedPropertyIds && allowedPropertyIds.size === 0) {
      return [];
    }

    const cap = Math.min(
      args.limit ?? GET_IN_RANGE_HARD_CAP,
      GET_IN_RANGE_HARD_CAP,
    );
    // Over-fetch when scoping so the post-filter doesn't underflow.
    const fetchCap = allowedPropertyIds
      ? Math.min(cap * 4, GET_IN_RANGE_HARD_CAP * 4)
      : cap;

    let stays = await ctx.db
      .query("stays")
      .withIndex("by_checkout", (q) => q.gt("checkOutAt", args.from))
      .take(fetchCap);

    stays = stays.filter(
      (stay) => stay.checkInAt < args.to && !stay.cancelledAt,
    );

    if (allowedPropertyIds) {
      stays = stays.filter((stay) => allowedPropertyIds.has(stay.propertyId));
    }

    return stays.slice(0, cap).map((stay) => ({
      _id: stay._id,
      propertyId: stay.propertyId,
      guestName: stay.guestName,
      guestPhotoUrl: stay.guestPhotoUrl,
      numberOfGuests: stay.numberOfGuests,
      platform: stay.platform,
      checkInAt: stay.checkInAt,
      checkOutAt: stay.checkOutAt,
    }));
  },
});
