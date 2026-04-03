import { query } from "../_generated/server";
import { requireRole } from "../lib/auth";

export const getSyncStatus = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["admin", "property_ops", "manager"]);

    const config = (await ctx.db.query("hospitableConfig").collect())[0] ?? null;
    return config;
  },
});
