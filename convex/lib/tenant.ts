/**
 * Multi-tenancy resolution, Phase 1 (dark).
 *
 * Resolves which `organizations` row the current caller belongs to. Phase 1 is
 * NON-enforcing: nothing in queries/mutations calls `requireOrg` yet, and
 * `cleaningCompanies.organizationId` is optional and unbackfilled, so these
 * helpers return null for existing single-tenant (J&A) data. They exist so the
 * later enforcement phase can flip scoping on in one place.
 *
 * Design: there is no Clerk org claim in the JWT today (auth.config.ts trusts a
 * single issuer and only exposes `identity.subject`). So the caller's org is
 * derived through the existing company tier, the same derivation the rest of
 * the codebase already uses for scoping (see companyScope.ts), rather than a
 * denormalized organizationId on every table. Caller -> active companyMembers
 * -> cleaningCompanies.organizationId -> organizations.
 *
 * See docs/2026-07-24-multi-tenancy-kickoff-plan.md and the billing spec.
 */

import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { getCurrentUser } from "./auth";
import { getLatestActiveCompanyMembership } from "./companyScope";

type Ctx = QueryCtx | MutationCtx;

/**
 * The organization the current caller belongs to, or null when it cannot be
 * derived (no active company membership, or the company has no org linked yet).
 * Never throws for "no org", callers decide whether that is allowed.
 */
export async function resolveCallerOrganization(
  ctx: Ctx,
): Promise<Doc<"organizations"> | null> {
  const user = await getCurrentUser(ctx);
  const membership = await getLatestActiveCompanyMembership(ctx, user._id);
  if (!membership) return null;

  const company = await ctx.db.get(membership.companyId);
  if (!company || !company.organizationId) return null;

  return await ctx.db.get(company.organizationId);
}

/**
 * Like {@link resolveCallerOrganization} but throws when no org is in scope.
 * NOT yet wired into any query/mutation, enable in the enforcement phase.
 */
export async function requireOrg(ctx: Ctx): Promise<Doc<"organizations">> {
  const org = await resolveCallerOrganization(ctx);
  if (!org) {
    throw new Error("No organization in scope for the current user.");
  }
  return org;
}

/**
 * Whether an organization currently has app access. `canceled` is the only
 * hard lockout; `past_due` keeps access during dunning (see billing spec §2).
 * Pure function, used by the future status gate, safe to unit-test.
 */
export function isOrganizationActive(org: Doc<"organizations">): boolean {
  return (
    org.status === "active" ||
    org.status === "trialing" ||
    org.status === "past_due"
  );
}
