import { v } from "convex/values";
import { query } from "../_generated/server";
import { getCurrentUser } from "../lib/auth";
import { getCallerJobScopeForListing } from "../lib/companyScope";

const GET_IN_RANGE_HARD_CAP = 500;

// Generous upper bound on a single reservation's length. Used to bound the
// historical lookback on the `by_checkin` index (see getInDateRange). STR /
// corporate-housing stays are well under this; a stay longer than 180 days
// that is still ongoing before the window would be the only miss — a
// non-case for this business.
const MAX_STAY_MS = 180 * 24 * 60 * 60 * 1000;

/**
 * Reservations overlapping a date window, across the caller's scoped
 * properties. Powers the schedule "Occupancy" view (Hospitable-style
 * reservation timeline).
 *
 * A stay overlaps [from, to) iff `checkInAt < to && checkOutAt > from`.
 * We index on `by_checkin` bounded on BOTH ends: any overlapping stay
 * checks in no earlier than `from - MAX_STAY_MS` (because `checkOutAt > from`
 * and a single reservation is at most MAX_STAY_MS long) and strictly before
 * `to`. The `checkOutAt > from` half is then applied in memory. This bounds
 * the documents read to the window (plus a fixed historical lookback),
 * instead of the old `by_checkout` lower-bound-only scan which walked EVERY
 * future reservation to +∞ and cost the full cap regardless of window width.
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
      .withIndex("by_checkin", (q) =>
        q.gte("checkInAt", args.from - MAX_STAY_MS).lt("checkInAt", args.to),
      )
      .take(fetchCap);

    stays = stays.filter(
      (stay) => stay.checkOutAt > args.from && !stay.cancelledAt,
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
