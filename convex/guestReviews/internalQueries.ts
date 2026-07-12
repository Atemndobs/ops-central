// convex/guestReviews/internalQueries.ts
import { v } from "convex/values";
import { internalQuery } from "../_generated/server";

export const getById = internalQuery({
  args: { reviewId: v.id("guestReviews") },
  handler: async (ctx, args) => ctx.db.get(args.reviewId),
});

export const getPropertyName = internalQuery({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args) => ctx.db.get(args.propertyId),
});
