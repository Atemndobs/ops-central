// Admin-side queries + actions for assigning owners to properties.
//
// Sister surface to convex/owner/*: those queries are AUTH-GATED to the
// owning user. These are auth-gated to admin/property_ops and let ops
// staff manage which users own which properties (the wiring that makes
// the owner portal point to the right user).

import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { internalAction, query } from "../_generated/server";
import { requireRole } from "../lib/auth";
import type { Doc, Id } from "../_generated/dataModel";

/**
 * Get current ownership state for a property: active owner rows joined
 * with their user records, plus the active fee config. Used by the
 * /properties/[id] admin page's "Owners & Fees" section.
 */
export const getPropertyOwnership = query({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin", "property_ops"]);
    const property = await ctx.db.get(args.propertyId);
    if (!property) throw new ConvexError("Property not found");

    const ownerRows = await ctx.db
      .query("propertyOwners")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();
    const active = ownerRows.filter((r) => r.effectiveTo === undefined);

    const owners = await Promise.all(
      active.map(async (row) => {
        const user = await ctx.db.get(row.userId);
        return {
          _id: row._id,
          userId: row.userId,
          stakePct: row.stakePct,
          role: row.role,
          isPrimaryApprover: row.isPrimaryApprover,
          effectiveFrom: row.effectiveFrom,
          user: user
            ? {
                _id: user._id,
                name: user.name ?? null,
                email: user.email,
                role: user.role,
                avatarUrl: user.avatarUrl ?? null,
              }
            : null,
        };
      }),
    );

    const configRows = await ctx.db
      .query("propertyFeeConfig")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();
    const activeConfig = configRows.find((c) => c.effectiveTo === undefined);

    return {
      property: {
        _id: property._id,
        name: property.name,
        address: property.address,
        currency: property.currency ?? "USD",
      },
      owners,
      feeConfig: activeConfig
        ? {
            _id: activeConfig._id,
            feePct: activeConfig.feePct,
            feeBase: activeConfig.feeBase,
            approvalThreshold: activeConfig.approvalThreshold,
            autoApproveAfterDays: activeConfig.autoApproveAfterDays ?? null,
            effectiveFrom: activeConfig.effectiveFrom,
          }
        : null,
      historyCount: {
        owners: ownerRows.length,
        feeConfigs: configRows.length,
      },
    };
  },
});

/**
 * List all users with role="owner" — for the "Add Owner" picker on the
 * property page. Returns lightweight rows (no metadata).
 */
export const listOwnerUsers = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["admin", "property_ops"]);
    const rows = await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "owner"))
      .collect();
    return rows.map((u) => ({
      _id: u._id,
      name: u.name ?? null,
      email: u.email,
      avatarUrl: u.avatarUrl ?? null,
    }));
  },
});
