import { v } from "convex/values";
import { query } from "../_generated/server";
import { requireRole } from "../lib/auth";

// Small config table — bare scan is intentional and safe (see schema.ts R1 note).
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["admin", "property_ops"]);
    return ctx.db.query("reviewResponseTemplates").collect();
  },
});

export const getByCategory = query({
  args: {
    reviewCategory: v.union(
      v.literal("glowing_5star"),
      v.literal("positive_4star"),
      v.literal("mixed_3star"),
      v.literal("critical_2star"),
    ),
    incentive: v.union(
      v.literal("none"),
      v.literal("return_discount"),
      v.literal("google_review"),
      v.literal("early_late_checkin"),
    ),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin", "property_ops"]);
    const all = await ctx.db.query("reviewResponseTemplates").collect();
    return all.find(
      (t) =>
        t.reviewCategory === args.reviewCategory &&
        t.incentive === args.incentive,
    ) ?? null;
  },
});
