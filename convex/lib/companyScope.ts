/**
 * Company-scope helpers for manager dispatch.
 *
 * A "manager" (platform `users.role === "manager"`) is scoped to the
 * cleaning company they have an active `companyMembers` row in, and from
 * there to the properties currently assigned to that company via
 * `companyProperties`. These helpers are the single source of truth for
 * that derivation — do not re-implement the join walk inline.
 *
 * Fail-closed contract: any caller without a current active membership,
 * or whose company has no active property assignments, gets an empty
 * scope. Empty scope is distinct from `null` (no scope = admin/ops).
 *
 * Extracted 2026-05-17 from inline copies in `cleaningJobs/queries.ts`,
 * `cleaningJobs/mutations.ts`, and `users/queries.ts`.
 */

import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

type Ctx = QueryCtx | MutationCtx;

export function isActiveCompanyPropertyAssignment(
  assignment: Doc<"companyProperties">,
): boolean {
  return assignment.isActive !== false && assignment.unassignedAt === undefined;
}

export function isActiveMembership(
  membership: Doc<"companyMembers">,
): boolean {
  return membership.isActive && membership.leftAt === undefined;
}

/**
 * The caller's most recently-joined active `companyMembers` row, or null.
 * Used to determine which company a user "belongs to right now."
 */
export async function getLatestActiveCompanyMembership(
  ctx: Ctx,
  userId: Id<"users">,
): Promise<Doc<"companyMembers"> | null> {
  const memberships = await ctx.db
    .query("companyMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();

  const active = memberships
    .filter(isActiveMembership)
    .sort((a, b) => b.joinedAt - a.joinedAt)[0];

  return active ?? null;
}

/**
 * The cleaning company currently servicing a property, or null when the
 * property has no active assignment. Picks the most-recently-assigned
 * active row when multiple exist (shouldn't, but the schema allows it).
 */
export async function getActivePropertyCompanyAssignment(
  ctx: Ctx,
  propertyId: Id<"properties">,
): Promise<Doc<"companyProperties"> | null> {
  const assignments = await ctx.db
    .query("companyProperties")
    .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
    .collect();

  const active = assignments
    .filter(isActiveCompanyPropertyAssignment)
    .sort((a, b) => b.assignedAt - a.assignedAt)[0];

  return active ?? null;
}

/**
 * True when a caller is allowed to load a single property by ID.
 *
 * - `admin` / `property_ops`: always true.
 * - `manager`: true iff the property is currently assigned to the
 *   manager's active company (via `companyProperties`). Managers with
 *   no active manager/owner membership get false.
 * - `cleaner`: false — cleaners reach properties via their assigned
 *   jobs, not via direct-ID load.
 *
 * Use for direct-ID guards (`getById`-style queries). For list queries
 * use `getCallerJobScopeForListing` and filter the result set.
 */
export async function canCallerAccessPropertyById(
  ctx: Ctx,
  user: Doc<"users">,
  propertyId: Id<"properties">,
): Promise<boolean> {
  if (user.role === "admin" || user.role === "property_ops") {
    return true;
  }

  if (user.role !== "manager") {
    return false;
  }

  // `users.role === "manager"` is the source of truth for "this caller
  // dispatches a cleaning company." The `companyMembers` row exists to
  // identify WHICH company — its `role` field (cleaner/manager/owner)
  // is the user's position inside the company and is orthogonal to
  // platform authority. Sofia Cleaning's launch state on prod has the
  // platform manager with a `companyMembers.role === "cleaner"` row,
  // which is a valid (if unusual) setup; we should still scope him to
  // that company.
  const membership = await getLatestActiveCompanyMembership(ctx, user._id);
  if (!membership) {
    return false;
  }

  const assignment = await getActivePropertyCompanyAssignment(ctx, propertyId);
  return assignment?.companyId === membership.companyId;
}

/**
 * Property scope for a caller, used by job/property/cleaner listings.
 *
 * - `admin` / `property_ops`: `null` (no scoping — see everything)
 * - `manager` with active manager/owner membership: `Set<propertyId>`
 *   from the active `companyProperties` rows for that company.
 *   Fail-closed: no membership or zero assignments → empty Set.
 * - `manager` without manager/owner membership (e.g. only a cleaner
 *   membership): empty Set.
 * - `cleaner`: empty Set — cleaners should use `getMyAssigned` /
 *   `userJobAssignments` instead of listing endpoints.
 *
 * Callers MUST treat `null` as "no filter" and a non-null Set with
 * size 0 as "return []". They are different states.
 */
export async function getCallerJobScopeForListing(
  ctx: Ctx,
  user: Doc<"users">,
): Promise<Set<Id<"properties">> | null> {
  if (user.role === "admin" || user.role === "property_ops") {
    return null;
  }

  if (user.role === "cleaner") {
    return new Set();
  }

  // See `canCallerAccessPropertyById` — platform role gates entry; the
  // companyMembers row only identifies which company the manager belongs
  // to. Any active membership counts.
  const membership = await getLatestActiveCompanyMembership(ctx, user._id);
  if (!membership) {
    return new Set();
  }

  const assignments = await ctx.db
    .query("companyProperties")
    .withIndex("by_company", (q) => q.eq("companyId", membership.companyId))
    .collect();

  return new Set(
    assignments
      .filter(isActiveCompanyPropertyAssignment)
      .map((a) => a.propertyId),
  );
}
