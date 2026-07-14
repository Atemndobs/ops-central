import { v } from "convex/values";
import { internalQuery, query } from "../_generated/server";
import { requireRole } from "../lib/auth";

export const getSyncStatus = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["admin", "property_ops", "manager"]);

    const config = (await ctx.db.query("hospitableConfig").collect())[0] ?? null;
    return config;
  },
});

/**
 * Used by `backfillReservationFinancials` action — returns stays whose
 * `totalAmount` is undefined AND `checkInAt >= sinceMs`. The property's
 * `hospitableId` is denormalized into each row so the action doesn't need
 * a second lookup per stay.
 */
/**
 * Used by `backfillReservationPlatforms` — returns stays whose `platform`
 * is undefined. Joins each property's `hospitableId` so the action can
 * call Hospitable directly without a second lookup.
 */
export const listStaysMissingPlatform = internalQuery({
  args: {},
  handler: async (ctx) => {
    const stays = await ctx.db.query("stays").collect();
    const candidates = stays.filter(
      (s) => s.platform === undefined && s.hospitableId !== undefined,
    );
    const out: Array<{
      _id: typeof candidates[number]["_id"];
      hospitableId: string;
      propertyHospitableId: string | undefined;
    }> = [];
    const propCache = new Map<
      typeof stays[number]["propertyId"],
      string | undefined
    >();
    for (const s of candidates) {
      let propertyHospitableId = propCache.get(s.propertyId);
      if (propertyHospitableId === undefined) {
        const p = await ctx.db.get(s.propertyId);
        propertyHospitableId = p?.hospitableId ?? undefined;
        propCache.set(s.propertyId, propertyHospitableId);
      }
      out.push({
        _id: s._id,
        hospitableId: s.hospitableId!,
        propertyHospitableId,
      });
    }
    return out;
  },
});

/**
 * Used by `syncGuestReviews` (daily backstop sync) — returns every property
 * that has a `hospitableId` set, since only those are queryable against
 * Hospitable's reviews endpoint.
 */
export const listPropertiesWithHospitableId = internalQuery({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("properties").collect();
    return all.filter((p) => !!p.hospitableId);
  },
});

export const listStaysMissingTotalAmount = internalQuery({
  args: {
    sinceMs: v.number(),
    /** When true, returns ALL stays in the window with a hospitableId
     *  (regardless of whether totalAmount is already set). Used by the
     *  backfill action's `forceRefresh` mode to correct values that were
     *  stored with a buggy extraction formula. Default false → original
     *  "only missing" behaviour. */
    includeAlreadyPopulated: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const stays = await ctx.db.query("stays").collect();
    const candidates = stays.filter(
      (s) =>
        (args.includeAlreadyPopulated || s.totalAmount === undefined) &&
        s.checkInAt >= args.sinceMs &&
        s.hospitableId !== undefined,
    );
    // Join property.hospitableId for each candidate
    const out: Array<{
      _id: typeof candidates[number]["_id"];
      hospitableId: string;
      propertyHospitableId: string | undefined;
    }> = [];
    const propCache = new Map<
      typeof stays[number]["propertyId"],
      string | undefined
    >();
    for (const s of candidates) {
      let propertyHospitableId = propCache.get(s.propertyId);
      if (propertyHospitableId === undefined) {
        const p = await ctx.db.get(s.propertyId);
        propertyHospitableId = p?.hospitableId ?? undefined;
        propCache.set(s.propertyId, propertyHospitableId);
      }
      out.push({
        _id: s._id,
        hospitableId: s.hospitableId!,
        propertyHospitableId,
      });
    }
    return out;
  },
});

export const listStaysMissingPhoto = internalQuery({
  args: {},
  handler: async (ctx) => {
    const stays = await ctx.db.query("stays").collect();
    return stays
      .filter((s) => !s.guestPhotoUrl && s.hospitableId)
      .map((s) => ({
        _id: s._id,
        hospitableId: s.hospitableId!,
        guestPhotoUrl: s.guestPhotoUrl,
      }));
  },
});
