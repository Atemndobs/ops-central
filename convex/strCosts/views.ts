import { query, mutation } from "../_generated/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";

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

/**
 * Owners we manage (from `propertyOwners`), for the "Client / company" picker
 * on the saved-view editor. One row per owner-user with an active stake, plus
 * the property ids they hold — so selecting an owner can auto-scope the view to
 * their properties. Active stake = `effectiveTo === undefined` (matches
 * admin/ownerOverview.loadActiveOwnerships).
 */
export const listStatementClients = query({
  args: {},
  handler: async (ctx) => {
    const ownerships = await ctx.db.query("propertyOwners").collect();
    const active = ownerships.filter((o) => o.effectiveTo === undefined);

    const byUser = new Map<string, Set<string>>();
    for (const o of active) {
      const set = byUser.get(o.userId as string) ?? new Set<string>();
      set.add(o.propertyId as string);
      byUser.set(o.userId as string, set);
    }

    const rows: Array<{
      userId: string;
      name: string;
      company: string | null;
      /** What prints on the statement: company if set, else the owner's name. */
      client: string;
      email: string | null;
      propertyIds: string[];
    }> = [];
    for (const [userId, propertyIds] of byUser.entries()) {
      const user = await ctx.db.get(userId as Id<"users">);
      if (!user) continue;
      const name = user.name ?? user.email ?? "(unnamed owner)";
      const company = user.company?.trim() || null;
      rows.push({
        userId,
        name,
        company,
        client: company ?? name,
        email: user.email ?? null,
        propertyIds: [...propertyIds],
      });
    }
    rows.sort((a, b) => a.client.localeCompare(b.client));
    return rows;
  },
});
