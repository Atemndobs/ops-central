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
export const listStaysMissingTotalAmount = internalQuery({
  args: { sinceMs: v.number() },
  handler: async (ctx, args) => {
    const stays = await ctx.db.query("stays").collect();
    const candidates = stays.filter(
      (s) =>
        s.totalAmount === undefined &&
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
