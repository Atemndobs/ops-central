import { query } from "../_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {
    includeInactive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const includeInactive = args.includeInactive ?? false;

    let properties;
    if (!includeInactive) {
      properties = await ctx.db
        .query("properties")
        .withIndex("by_active", (q) => q.eq("isActive", true))
        .collect();
    } else {
      properties = await ctx.db.query("properties").collect();
    }

    return properties.sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
  },
});

export const getById = query({
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

export const search = query({
  args: {
    query: v.string(),
    includeInactive: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const includeInactive = args.includeInactive ?? false;
    const queryText = args.query.trim().toLowerCase();
    const limit = args.limit ?? 50;
    const cap = Math.max(1, Math.min(limit, 100));

    if (!queryText) {
      let properties;
      if (!includeInactive) {
        properties = await ctx.db
          .query("properties")
          .withIndex("by_active", (q) => q.eq("isActive", true))
          .collect();
      } else {
        properties = await ctx.db.query("properties").collect();
      }
      return properties
        .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))
        .slice(0, cap);
    }

    // search_name has no filterFields, so filter isActive in memory
    const results = await ctx.db
      .query("properties")
      .withSearchIndex("search_name", (q) => q.search("name", queryText))
      .take(cap * 2); // fetch extra to account for in-memory filtering

    const filtered = includeInactive
      ? results
      : results.filter((property) => property.isActive);

    return filtered.slice(0, cap);
  },
});

export const getAll = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 500;

    const properties = await ctx.db
      .query("properties")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .collect();

    return properties
      .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))
      .slice(0, limit);
  },
});
