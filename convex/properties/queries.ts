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

    let properties;
    if (args.status) {
      properties = await ctx.db
        .query("properties")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .collect();
    } else if (!includeInactive) {
      properties = await ctx.db
        .query("properties")
        .withIndex("by_isActive", (q) => q.eq("isActive", true))
        .collect();
    } else {
      properties = await ctx.db.query("properties").collect();
    }

    if (!includeInactive && args.status) {
      properties = properties.filter((property) => property.isActive);
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

    if (!queryText) {
      const fallback = await ctx.db
        .query("properties")
        .withIndex("by_updatedAt")
        .collect();
      const filtered = fallback.filter((property) => {
        if (!includeInactive && !property.isActive) {
          return false;
        }
        if (args.status && property.status !== args.status) {
          return false;
        }
        return true;
      });
      return filtered
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, Math.max(1, Math.min(limit, 100)));
    }

    const results = await ctx.db
      .query("properties")
      .withSearchIndex("search_name", (q) => {
        const withQuery = q.search("name", queryText);
        if (args.status) {
          return withQuery.eq("status", args.status);
        }
        if (!includeInactive) {
          return withQuery.eq("isActive", true);
        }
        return withQuery;
      })
      .take(Math.max(1, Math.min(limit, 100)));

    return includeInactive ? results : results.filter((property) => property.isActive);
  },
});
