import { v } from "convex/values";
import { internalQuery, query } from "../_generated/server";
import { getCurrentUser } from "../lib/auth";
import { requireRole } from "../lib/auth";
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

const UNREVIEWED_WINDOW_MS = 60 * 24 * 60 * 60 * 1000; // 60-day lookback
const UNREVIEWED_CAP = 100;
// guestReviews grows slowly (~7/mo); hard-capped at 300 so this never
// becomes a full-table read even as the business scales.
const REVIEW_SCAN_CAP = 300;

export const getOutreachContext = internalQuery({
  args: { stayId: v.id("stays") },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin", "property_ops", "manager"]);
    const stay = await ctx.db.get(args.stayId);
    if (!stay || stay.cancelledAt) return null;
    const property = await ctx.db.get(stay.propertyId);
    return {
      stayId: stay._id,
      hospitableId: stay.hospitableId,
      guestName: stay.guestName,
      propertyName: property?.name ?? "the property",
      checkInAt: stay.checkInAt,
      checkOutAt: stay.checkOutAt,
    };
  },
});

/**
 * Recent checkouts with no linked guest review — the "low hanging fruit"
 * outreach list. Sorted newest-checkout-first.
 *
 * R1: stays scanned via by_checkout index with two-sided date bounds.
 * R4: guestReviews bounded at REVIEW_SCAN_CAP (grows ~7/mo; safe for years).
 * R3: stayId set built in memory before filtering stays — no per-row queries.
 */
export const getUnreviewedCheckouts = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["admin", "property_ops", "manager"]);

    const now = Date.now();
    const windowStart = now - UNREVIEWED_WINDOW_MS;

    // Bounded two-sided scan on stays (R1 compliant).
    const recentStays = await ctx.db
      .query("stays")
      .withIndex("by_checkout", (q) =>
        q.gte("checkOutAt", windowStart).lte("checkOutAt", now),
      )
      .take(UNREVIEWED_CAP * 4); // over-fetch before filtering cancelled

    const activeStays = recentStays.filter((s) => !s.cancelledAt);

    // Build a set of reviewed (propertyId:normalizedGuestName) pairs in one
    // bounded read (R3: no per-row queries). guestReviews has no stayId FK;
    // we match on propertyId + full name since both come from Hospitable and
    // use consistent formatting. REVIEW_SCAN_CAP keeps cost bounded for years.
    const reviews = await ctx.db
      .query("guestReviews")
      .withIndex("by_status")
      .take(REVIEW_SCAN_CAP);
    const reviewedKeys = new Set(
      reviews.map(
        (r) =>
          `${r.propertyId}:${(r.guestFirstName + " " + r.guestLastName).toLowerCase().trim()}`,
      ),
    );

    // Enrich with property name in one batched pass (R3 compliant).
    const propertyIds = [...new Set(activeStays.map((s) => s.propertyId))];
    const properties = await Promise.all(propertyIds.map((id) => ctx.db.get(id)));
    const propName = new Map(
      properties.flatMap((p) => (p ? [[p._id, p.name]] : [])),
    );

    return activeStays
      .filter((s) => {
        const key = `${s.propertyId}:${s.guestName.toLowerCase().trim()}`;
        return !reviewedKeys.has(key);
      })
      .slice(0, UNREVIEWED_CAP)
      .map((s) => ({
        _id: s._id,
        propertyId: s.propertyId,
        propertyName: propName.get(s.propertyId) ?? null,
        guestName: s.guestName,
        guestPhotoUrl: s.guestPhotoUrl,
        guestEmail: s.guestEmail,
        platform: s.platform ?? null,
        checkInAt: s.checkInAt,
        checkOutAt: s.checkOutAt,
      }));
  },
});
