import { query, mutation } from "../_generated/server";
import { v } from "convex/values";

/**
 * List all saved portfolio views, ordered by name.
 */
export const listViews = query({
  args: {},
  handler: async (ctx) => {
    const views = await ctx.db.query("portfolioViews").collect();
    return views.slice().sort((a, b) => a.name.localeCompare(b.name));
  },
});

/**
 * Create a new portfolio view, or update an existing one.
 * - If `id` is provided, patches the existing record and returns its id.
 * - Otherwise, inserts a new record and returns the new id.
 */
export const saveView = mutation({
  args: {
    id: v.optional(v.id("portfolioViews")),
    name: v.string(),
    clientName: v.optional(v.string()),
    propertyIds: v.array(v.id("properties")),
  },
  handler: async (ctx, args) => {
    if (args.id !== undefined) {
      await ctx.db.patch(args.id, {
        name: args.name,
        clientName: args.clientName,
        propertyIds: args.propertyIds,
        updatedAt: Date.now(),
      });
      return args.id;
    }
    return await ctx.db.insert("portfolioViews", {
      name: args.name,
      clientName: args.clientName,
      propertyIds: args.propertyIds,
      createdAt: Date.now(),
    });
  },
});

/**
 * Delete a saved portfolio view by id.
 */
export const deleteView = mutation({
  args: {
    id: v.id("portfolioViews"),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return null;
  },
});
