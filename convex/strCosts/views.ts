import { query, mutation } from "../_generated/server";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { groupActiveByUser, resolveOwnerClient } from "../lib/ownership";
import { resolveViewFields } from "./viewResolution";

/**
 * List all saved portfolio views, ordered by name.
 *
 * Owner-BOUND views (ownerUserId set) come back with clientName and
 * propertyIds derived LIVE from users + propertyOwners, so the Monthly Close
 * table and statement export always reflect current ownership. Unbound views
 * pass their stored fields through unchanged.
 */
export const listViews = query({
  args: {},
  handler: async (ctx) => {
    const views = await ctx.db.query("portfolioViews").collect();
    const resolved = await Promise.all(
      views.map(async (view) => {
        const ownerUserId = view.ownerUserId;
        if (ownerUserId === undefined) {
          return { ...view, ...resolveViewFields(view, null, []) };
        }
        const [user, stakes] = await Promise.all([
          ctx.db.get(ownerUserId),
          ctx.db
            .query("propertyOwners")
            .withIndex("by_user_and_active", (q) =>
              q.eq("userId", ownerUserId).eq("effectiveTo", undefined),
            )
            .collect(),
        ]);
        const ownerClient = user ? resolveOwnerClient(user) : null;
        const activePropertyIds = [
          ...new Set(stakes.map((s) => s.propertyId)),
        ];
        return {
          ...view,
          ...resolveViewFields(view, ownerClient, activePropertyIds),
        };
      }),
    );
    return resolved.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/**
 * Create a new portfolio view, or update an existing one.
 * - If `id` is provided, patches the existing record and returns its id.
 * - Otherwise, inserts a new record and returns the new id.
 * - If `ownerUserId` is provided the view is BOUND: the server derives the
 *   stored clientName from the owner's profile (company, else name) so it can
 *   never drift from users/propertyOwners. Passing ownerUserId: undefined on
 *   an update UNBINDS the view (Convex patch removes undefined fields).
 */
export const saveView = mutation({
  args: {
    id: v.optional(v.id("portfolioViews")),
    name: v.string(),
    clientName: v.optional(v.string()),
    propertyIds: v.array(v.id("properties")),
    ownerUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    let clientName = args.clientName;
    if (args.ownerUserId !== undefined) {
      const owner = await ctx.db.get(args.ownerUserId);
      if (!owner) throw new ConvexError("Owner user not found");
      clientName = resolveOwnerClient(owner);
    }
    if (args.id !== undefined) {
      await ctx.db.patch(args.id, {
        name: args.name,
        clientName,
        propertyIds: args.propertyIds,
        ownerUserId: args.ownerUserId,
        updatedAt: Date.now(),
      });
      return args.id;
    }
    return await ctx.db.insert("portfolioViews", {
      name: args.name,
      clientName,
      propertyIds: args.propertyIds,
      ownerUserId: args.ownerUserId,
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
 * the property ids they hold — so selecting an owner can auto-scope the view
 * to their properties. Active stake = `effectiveTo === undefined` (same rule
 * as convex/lib/ownership helpers).
 */
export const listStatementClients = query({
  args: {},
  handler: async (ctx) => {
    const ownerships = await ctx.db.query("propertyOwners").collect();
    const byUser = groupActiveByUser(ownerships);

    const rows: Array<{
      userId: string;
      name: string;
      company: string | null;
      /** What prints on the statement: company if set, else the owner's name. */
      client: string;
      email: string | null;
      propertyIds: string[];
    }> = [];
    for (const [userId, stakes] of byUser.entries()) {
      const user = await ctx.db.get(userId as Id<"users">);
      if (!user) continue;
      const name = user.name ?? user.email ?? "(unnamed owner)";
      const company = user.company?.trim() || null;
      rows.push({
        userId,
        name,
        company,
        client: resolveOwnerClient(user),
        email: user.email ?? null,
        propertyIds: [...new Set(stakes.map((s) => s.propertyId as string))],
      });
    }
    rows.sort((a, b) => a.client.localeCompare(b.client));
    return rows;
  },
});
