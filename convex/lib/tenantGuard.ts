/**
 * Multi-tenancy activation: flag-gated org guards for live query/mutation paths.
 *
 * Impure (reads the DB, composes the tenant/companyScope/orgAccess helpers), so
 * it lives outside the type-only files and is not node-tested; the isolation
 * logic it delegates to (orgAccess.assertOrganizationAccess / isSameOrganization)
 * IS unit-tested. Everything here is a NO-OP until the `tenancy_enforced`
 * feature flag is turned on. See docs/2026-07-25-tenancy-phase2-enforcement-plan.md.
 */

import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { resolveCallerOrganization } from "./tenant";
import {
  getActivePropertyCompanyAssignment,
  isActiveCompanyPropertyAssignment,
} from "./companyScope";
import { isSameOrganization } from "./orgAccess";

type Ctx = QueryCtx | MutationCtx;

/**
 * Whether cross-org isolation is currently enforced. Defaults to false.
 *
 * Read from a Convex environment variable (dashboard: Settings ->
 * Environment Variables -> `TENANCY_ENFORCED=true`) rather than a featureFlags
 * row, so flipping it needs no schema change / codegen / deploy and takes
 * effect immediately. Kept async so the call sites (and a future switch to a
 * DB-backed flag) stay unchanged.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function isTenancyEnforced(_ctx: Ctx): Promise<boolean> {
  return process.env.TENANCY_ENFORCED === "true";
}

/**
 * The organization that owns a property, derived through its active company
 * assignment (companyProperties -> cleaningCompanies.organizationId). Undefined
 * when the property has no active assignment or the company has no org yet.
 */
export async function resolvePropertyOrganization(
  ctx: Ctx,
  propertyId: Id<"properties">,
): Promise<Id<"organizations"> | undefined> {
  const assignment = await getActivePropertyCompanyAssignment(ctx, propertyId);
  if (!assignment) return undefined;
  const company = await ctx.db.get(assignment.companyId);
  return company?.organizationId ?? undefined;
}

/**
 * Boolean org guard for query-style callers that return null on deny.
 *
 * Returns true (allow) when: enforcement is off; the caller has no derivable
 * org (e.g. admin/ops, unscoped); or the property has no org yet (legacy /
 * mid-backfill). Only returns false when both orgs are known and differ.
 */
export async function callerSharesOrgForProperty(
  ctx: Ctx,
  propertyId: Id<"properties">,
): Promise<boolean> {
  if (!(await isTenancyEnforced(ctx))) return true;

  const callerOrg = await resolveCallerOrganization(ctx);
  const resourceOrg = await resolvePropertyOrganization(ctx, propertyId);
  if (!callerOrg || !resourceOrg) return true;

  return isSameOrganization(callerOrg._id, resourceOrg);
}

/**
 * The set of property ids that belong to the caller's organization, for
 * filtering LIST queries. Returns null when there is no org restriction to
 * apply: enforcement off, or the caller has no derivable org (e.g. an unscoped
 * global admin during rollout) - callers treat null as "do not filter".
 *
 * Derived via the Phase 1 by_organization index: org -> its cleaningCompanies
 * -> their active companyProperties -> propertyIds.
 */
export async function getCallerOrgPropertyIds(
  ctx: Ctx,
): Promise<Set<Id<"properties">> | null> {
  if (!(await isTenancyEnforced(ctx))) return null;

  const callerOrg = await resolveCallerOrganization(ctx);
  if (!callerOrg) return null;

  const companies = await ctx.db
    .query("cleaningCompanies")
    .withIndex("by_organization", (q) =>
      q.eq("organizationId", callerOrg._id),
    )
    .collect();

  const propertyIds = new Set<Id<"properties">>();
  for (const company of companies) {
    const assignments = await ctx.db
      .query("companyProperties")
      .withIndex("by_company", (q) => q.eq("companyId", company._id))
      .collect();
    for (const assignment of assignments) {
      if (isActiveCompanyPropertyAssignment(assignment)) {
        propertyIds.add(assignment.propertyId);
      }
    }
  }
  return propertyIds;
}
