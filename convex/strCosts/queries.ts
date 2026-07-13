import { query } from "../_generated/server";
import { requireRole } from "../lib/auth";

/**
 * Lightweight property list for the Monthly Close view manager / import mapper.
 * Returns every property (id + name + a little location/status context) sorted
 * by name. The ViewManager checklist and the Hospitable import mapper consume
 * this — they need the full set regardless of active status.
 *
 * Financial tool: restricted to admin / property_ops (ops-finance). Cleaning
 * managers and cleaners have no access to portfolio financials.
 */
export const getProperties = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["admin", "property_ops"]);
    const props = await ctx.db.query("properties").collect();
    return props
      .map((p) => ({
        _id: p._id,
        name: p.name,
        city: p.city ?? null,
        state: p.state ?? null,
        status: p.pnlStatus ?? (p.isActive ? "active" : "dropped"),
        hospitableId: p.hospitableId ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});
