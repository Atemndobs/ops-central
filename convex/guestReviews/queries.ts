import { v } from "convex/values";
import { query } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { requireRole } from "../lib/auth";

const guestReviewValidator = v.object({
  _id: v.id("guestReviews"),
  _creationTime: v.number(),
  hospitableReviewId: v.string(),
  propertyId: v.id("properties"),
  propertyName: v.optional(v.string()),
  guestPhotoUrl: v.optional(v.string()),
  platform: v.union(v.literal("airbnb"), v.literal("direct")),
  rating: v.number(),
  publicReview: v.string(),
  privateFeedback: v.optional(v.string()),
  guestFirstName: v.string(),
  guestLastName: v.string(),
  reviewedAt: v.number(),
  canRespond: v.boolean(),
  status: v.union(
    v.literal("needs_draft"),
    v.literal("drafted"),
    v.literal("sending"),
    v.literal("sent"),
    v.literal("dismissed"),
    v.literal("send_failed"),
  ),
  aiDraftText: v.optional(v.string()),
  aiDraftGeneratedAt: v.optional(v.number()),
  respondedText: v.optional(v.string()),
  respondedAt: v.optional(v.number()),
  sendError: v.optional(v.string()),
});

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Pick a review's guest photo from a property's stays — pure, in memory.
 *
 * Read-cost: this was previously `resolveGuestPhotoUrl(ctx, propertyId, reviewedAt)`,
 * which ran a full `stays.by_property(propertyId).collect()` on EVERY call — and it
 * was called once per review row. `listInbox` (~124 reviews across ~8 properties)
 * therefore re-scanned a property's entire stay list ~124 times per execution, and
 * it's a reactive query, so that repeated on every review write (~1.16 GB/mo — the
 * #3 read consumer). Callers now fetch each property's stays ONCE and pass them in.
 */
function pickGuestPhotoUrl(
  stays: Doc<"stays">[],
  reviewedAt: number,
): string | undefined {
  const candidates = stays.filter(
    (s) => s.checkOutAt <= reviewedAt && s.checkOutAt >= reviewedAt - THIRTY_DAYS_MS,
  );
  if (candidates.length === 0) return undefined;
  return candidates.sort((a, b) => b.checkOutAt - a.checkOutAt)[0].guestPhotoUrl;
}

/** Generous upper bound on a single reservation's length — see fetchStaysByProperty. */
const MAX_STAY_MS = 180 * 24 * 60 * 60 * 1000;

/**
 * Fetch each property's stays exactly once, keyed by propertyId, bounded to the
 * check-out window the callers can actually use.
 *
 * Read-cost: this previously read each property's ENTIRE stay history via
 * `by_property` — it fixed the per-review N+1 but left the remaining per-property
 * reads unbounded, so cost still grew forever with reservation history on a
 * reactive query. `pickGuestPhotoUrl` only ever looks at stays whose `checkOutAt`
 * falls in [reviewedAt - 30d, reviewedAt], so callers pass the union of those
 * windows across their reviews.
 *
 * There is no [propertyId, checkOutAt] index, but `by_property_dates` is
 * [propertyId, checkInAt, checkOutAt]. Since checkOutAt >= checkInAt and a stay is
 * at most MAX_STAY_MS long, any stay checking out in [from, to] must check in
 * within [from - MAX_STAY_MS, to] — so bound `checkInAt` on the index and let
 * `pickGuestPhotoUrl` apply the exact `checkOutAt` predicate in memory.
 */
async function fetchStaysByProperty(
  ctx: QueryCtx,
  propertyIds: Id<"properties">[],
  checkOutWindow: { from: number; to: number },
): Promise<Map<Id<"properties">, Doc<"stays">[]>> {
  const checkInFloor = checkOutWindow.from - MAX_STAY_MS;
  const lists = await Promise.all(
    propertyIds.map((propertyId) =>
      ctx.db
        .query("stays")
        .withIndex("by_property_dates", (q) =>
          q
            .eq("propertyId", propertyId)
            .gte("checkInAt", checkInFloor)
            .lte("checkInAt", checkOutWindow.to),
        )
        .collect(),
    ),
  );
  return new Map(propertyIds.map((propertyId, index) => [propertyId, lists[index]]));
}

/** Union of the per-review guest-photo lookup windows. */
function guestPhotoWindow(reviewedAts: number[]): { from: number; to: number } {
  const to = Math.max(...reviewedAts);
  const from = Math.min(...reviewedAts) - THIRTY_DAYS_MS;
  return { from, to };
}

// Needs-action statuses sort first in the inbox.
const NEEDS_ACTION = new Set(["needs_draft", "drafted", "send_failed"]);

/**
 * Cross-property inbox, needs-action reviews first (needs_draft, drafted,
 * send_failed), then everything else, both groups newest-reviewed first.
 */
export const listInbox = query({
  args: {},
  returns: v.array(guestReviewValidator),
  handler: async (ctx) => {
    await requireRole(ctx, ["admin", "property_ops"]);

    const rows = await ctx.db.query("guestReviews").collect();
    if (rows.length === 0) return [];

    // Read-cost: this previously did `ctx.db.get(propertyId)` AND a full
    // per-property stays scan for EVERY review row. With ~124 reviews across ~8
    // properties that meant ~116 redundant property reads plus ~124 redundant
    // whole-property stay scans on every reactive re-execution. Fetch each unique
    // property (and its stays) exactly once, then resolve in memory. Same output.
    const uniquePropertyIds = [...new Set(rows.map((row) => row.propertyId))];
    const [propertyDocs, staysByPropertyId] = await Promise.all([
      Promise.all(uniquePropertyIds.map((propertyId) => ctx.db.get(propertyId))),
      fetchStaysByProperty(
        ctx,
        uniquePropertyIds,
        guestPhotoWindow(rows.map((row) => row.reviewedAt)),
      ),
    ]);
    const propertyNameById = new Map(
      uniquePropertyIds.map((propertyId, index) => [propertyId, propertyDocs[index]?.name]),
    );

    const withNames = rows.map((row) => ({
      ...row,
      propertyName: propertyNameById.get(row.propertyId),
      guestPhotoUrl: pickGuestPhotoUrl(
        staysByPropertyId.get(row.propertyId) ?? [],
        row.reviewedAt,
      ),
    }));

    return withNames.sort((a, b) => {
      const aNeeds = NEEDS_ACTION.has(a.status) ? 0 : 1;
      const bNeeds = NEEDS_ACTION.has(b.status) ? 0 : 1;
      if (aNeeds !== bNeeds) return aNeeds - bNeeds;
      return b.reviewedAt - a.reviewedAt;
    });
  },
});

export const getInboxSummary = query({
  args: {},
  returns: v.object({
    totalReviews: v.number(),
    avgRating: v.number(),
    fiveStarPct: v.number(),
    badReviewsUnanswered: v.number(),
    canStillRespond: v.number(),
    propertyHealth: v.array(v.object({
      propertyId: v.id("properties"),
      propertyName: v.optional(v.string()),
      reviewCount: v.number(),
      avgRating: v.number(),
      badCount: v.number(),
      respondedCount: v.number(),
    })),
  }),
  handler: async (ctx) => {
    await requireRole(ctx, ["admin", "property_ops"]);

    const rows = await ctx.db.query("guestReviews").collect();
    if (rows.length === 0) {
      return { totalReviews: 0, avgRating: 0, fiveStarPct: 0, badReviewsUnanswered: 0, canStillRespond: 0, propertyHealth: [] };
    }

    const totalReviews = rows.length;
    const avgRating = rows.reduce((s, r) => s + r.rating, 0) / totalReviews;
    const fiveStarPct = Math.round((rows.filter((r) => r.rating === 5).length / totalReviews) * 100);
    const badReviewsUnanswered = rows.filter(
      (r) => r.rating <= 3 && r.status !== "sent" && r.status !== "dismissed",
    ).length;
    const canStillRespond = rows.filter(
      (r) => r.canRespond && r.status !== "sent",
    ).length;

    // Per-property aggregation
    const byProperty = new Map<string, { propertyId: typeof rows[0]["propertyId"]; ratings: number[]; badCount: number; respondedCount: number }>();
    for (const r of rows) {
      const id = r.propertyId as string;
      const existing = byProperty.get(id) ?? { propertyId: r.propertyId, ratings: [], badCount: 0, respondedCount: 0 };
      existing.ratings.push(r.rating);
      if (r.rating <= 3) existing.badCount++;
      if (r.status === "sent") existing.respondedCount++;
      byProperty.set(id, existing);
    }

    const propertyHealth = await Promise.all(
      [...byProperty.entries()].map(async ([, v]) => {
        const property = await ctx.db.get(v.propertyId);
        return {
          propertyId: v.propertyId,
          propertyName: property?.name,
          reviewCount: v.ratings.length,
          avgRating: v.ratings.reduce((s, r) => s + r, 0) / v.ratings.length,
          badCount: v.badCount,
          respondedCount: v.respondedCount,
        };
      }),
    );

    // Sort by bad count desc, then review count desc
    propertyHealth.sort((a, b) => b.badCount - a.badCount || b.reviewCount - a.reviewCount);

    return { totalReviews, avgRating, fiveStarPct, badReviewsUnanswered, canStillRespond, propertyHealth };
  },
});

/** Reviews for a single property, for the property-detail Reviews section. */
export const listByProperty = query({
  args: { propertyId: v.id("properties") },
  returns: v.array(guestReviewValidator),
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin", "property_ops"]);

    const rows = await ctx.db
      .query("guestReviews")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();

    // Read-cost: same fix as listInbox — the stays read used to run once per review
    // row for this single property, and then (after that was batched) still pulled
    // the property's entire stay history. Fetch it once, bounded to the check-out
    // window the photo lookup can actually use, and resolve in memory.
    if (rows.length === 0) {
      return [];
    }
    const [property, staysByPropertyId] = await Promise.all([
      ctx.db.get(args.propertyId),
      fetchStaysByProperty(
        ctx,
        [args.propertyId],
        guestPhotoWindow(rows.map((row) => row.reviewedAt)),
      ),
    ]);
    const stays = staysByPropertyId.get(args.propertyId) ?? [];
    const withPhotos = rows.map((row) => ({
      ...row,
      propertyName: property?.name,
      guestPhotoUrl: pickGuestPhotoUrl(stays, row.reviewedAt),
    }));
    return withPhotos.sort((a, b) => b.reviewedAt - a.reviewedAt);
  },
});
