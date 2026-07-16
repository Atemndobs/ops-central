import { v } from "convex/values";
import { internalQuery } from "../_generated/server";

// Small config table: bare scan is intentional and safe (R1 exemption).
export const getByKey = internalQuery({
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
    const all = await ctx.db.query("reviewResponseTemplates").collect();
    return (
      all.find(
        (t) =>
          t.reviewCategory === args.reviewCategory &&
          t.incentive === args.incentive,
      ) ?? null
    );
  },
});
