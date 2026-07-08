// Owner-portal auth helpers. Every owner-facing query/mutation MUST go through
// these — convention drift is too risky for a money-handling surface.
//
// Spec §10. Pattern: each helper composes on top of `convex/lib/auth.ts`
// primitives (requireAuth, getCurrentUser, requireRole), then layers
// owner-specific ownership checks driven by the `propertyOwners` table.

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { getCurrentUser } from "../lib/auth";

/** The currently authenticated user, asserted to have role="owner". */
export async function requireOwnerUser(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users">> {
  const user = await getCurrentUser(ctx);
  if (user.role !== "owner") {
    throw new Error(
      `Owner portal requires role="owner". Your role: ${user.role}. ` +
        `Admins/property_ops can view-as-owner in v2 (deferred).`,
    );
  }
  return user;
}

/** Find an active `propertyOwners` row for (userId, propertyId), or null. */
export async function findActiveOwnership(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  propertyId: Id<"properties">,
): Promise<Doc<"propertyOwners"> | null> {
  const rows = await ctx.db
    .query("propertyOwners")
    .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
    .collect();
  return (
    rows.find(
      (row) => row.userId === userId && row.effectiveTo === undefined,
    ) ?? null
  );
}

/**
 * Assert the authenticated user is an active owner of `propertyId`. Returns
 * the matching `propertyOwners` row for downstream use (e.g. primary-approver
 * check). Throws if the caller isn't an owner OR isn't on this property.
 *
 * The standard guard for every property-scoped owner query/mutation.
 */
export async function assertOwnerOfProperty(
  ctx: QueryCtx | MutationCtx,
  propertyId: Id<"properties">,
): Promise<{ user: Doc<"users">; ownership: Doc<"propertyOwners"> }> {
  const user = await requireOwnerUser(ctx);
  const ownership = await findActiveOwnership(ctx, user._id, propertyId);
  if (!ownership) {
    throw new Error(
      `User ${user._id} is not an active owner of property ${propertyId}.`,
    );
  }
  return { user, ownership };
}

/**
 * Stricter variant: caller must be the PRIMARY approver for the property.
 * Used by maintenance-approval mutations.
 */
export async function assertPrimaryApprover(
  ctx: QueryCtx | MutationCtx,
  propertyId: Id<"properties">,
): Promise<{ user: Doc<"users">; ownership: Doc<"propertyOwners"> }> {
  const result = await assertOwnerOfProperty(ctx, propertyId);
  if (!result.ownership.isPrimaryApprover) {
    throw new Error(
      `User ${result.user._id} is not the primary approver for property ${propertyId}.`,
    );
  }
  return result;
}

/**
 * List all properties the authenticated owner has an active ownership row
 * for. Returns property IDs only — callers can `ctx.db.get(id)` as needed.
 */
export async function listOwnedPropertyIds(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<Id<"properties">[]> {
  // by_user_and_active is indexed on [userId, effectiveTo]; effectiveTo===undefined
  // = currently active. Convex doesn't let us .eq(undefined) cleanly, so we filter
  // in memory — owner count per user is small (<10 even at scale).
  const rows = await ctx.db
    .query("propertyOwners")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  return rows
    .filter((row) => row.effectiveTo === undefined)
    .map((row) => row.propertyId);
}
