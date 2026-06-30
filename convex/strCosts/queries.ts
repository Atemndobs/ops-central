import { query } from "../_generated/server";

/**
 * Lightweight property list for the Monthly Close view manager / import mapper.
 * Returns every property (id + name + a little location/status context) sorted
 * by name. The ViewManager checklist and the Hospitable import mapper consume
 * this — they need the full set regardless of active status.
 */
export const getProperties = query({
  args: {},
  handler: async (ctx) => {
    const props = await ctx.db.query("properties").collect();
    return props
      .map((p) => ({
        _id: p._id,
        name: p.name,
        city: p.city ?? null,
        state: p.state ?? null,
        status: p.status ?? (p.isActive ? "active" : "dropped"),
        hospitableId: p.hospitableId ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});
