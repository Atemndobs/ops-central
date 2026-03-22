import { queryGeneric } from "convex/server";
import { v } from "convex/values";

export const list = queryGeneric({
  args: {
    includeInactive: v.optional(v.boolean()),
    status: v.optional(
      v.union(
        v.literal("ready"),
        v.literal("dirty"),
        v.literal("in_progress"),
        v.literal("vacant"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const includeInactive = args.includeInactive ?? false;

    let properties = await ctx.db.query("properties").collect();

    if (!includeInactive) {
      properties = properties.filter((property) => property.isActive);
    }

    if (args.status) {
      properties = properties.filter((property) => property.status === args.status);
    }

    return properties.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const getById = queryGeneric({
  args: {
    id: v.id("properties"),
  },
  handler: async (ctx, args) => {
    const property = await ctx.db.get(args.id);

    if (!property || !property.isActive) {
      return null;
    }

    return property;
  },
});

export const search = queryGeneric({
  args: {
    query: v.string(),
    status: v.optional(
      v.union(
        v.literal("ready"),
        v.literal("dirty"),
        v.literal("in_progress"),
        v.literal("vacant"),
      ),
    ),
    includeInactive: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const includeInactive = args.includeInactive ?? false;
    const queryText = args.query.trim().toLowerCase();
    const limit = args.limit ?? 50;

    let properties = await ctx.db.query("properties").collect();

    if (!includeInactive) {
      properties = properties.filter((property) => property.isActive);
    }

    if (args.status) {
      properties = properties.filter((property) => property.status === args.status);
    }

    if (queryText.length > 0) {
      properties = properties.filter((property) => {
        const searchableText = [
          property.name,
          property.address,
          property.city,
          property.state,
          property.postalCode,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return searchableText.includes(queryText);
      });
    }

    return properties
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, Math.max(1, Math.min(limit, 100)));
  },
});
