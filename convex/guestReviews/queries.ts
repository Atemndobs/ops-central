import { v } from "convex/values";
import { query } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
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

async function resolveGuestPhotoUrl(
  ctx: QueryCtx,
  propertyId: string,
  reviewedAt: number,
): Promise<string | undefined> {
  const stays = await ctx.db
    .query("stays")
    .withIndex("by_property", (q) => q.eq("propertyId", propertyId as Parameters<typeof q.eq>[1]))
    .collect();
  const candidates = stays.filter(
    (s) => s.checkOutAt <= reviewedAt && s.checkOutAt >= reviewedAt - THIRTY_DAYS_MS,
  );
  if (candidates.length === 0) return undefined;
  return candidates.sort((a, b) => b.checkOutAt - a.checkOutAt)[0].guestPhotoUrl;
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
    const withNames = await Promise.all(
      rows.map(async (row) => {
        const property = await ctx.db.get(row.propertyId);
        const guestPhotoUrl = await resolveGuestPhotoUrl(ctx, row.propertyId, row.reviewedAt);
        return { ...row, propertyName: property?.name, guestPhotoUrl };
      }),
    );

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

    const property = await ctx.db.get(args.propertyId);
    const withPhotos = await Promise.all(
      rows.map(async (row) => {
        const guestPhotoUrl = await resolveGuestPhotoUrl(ctx, row.propertyId, row.reviewedAt);
        return { ...row, propertyName: property?.name, guestPhotoUrl };
      }),
    );
    return withPhotos.sort((a, b) => b.reviewedAt - a.reviewedAt);
  },
});
