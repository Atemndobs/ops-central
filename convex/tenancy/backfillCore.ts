/**
 * Multi-tenancy Phase 2: J&A organization backfill: pure logic.
 *
 * Kept separate from backfill.ts (the internalMutation wrapper) so this file
 * imports ONLY types from _generated. That lets `node --test` load it without
 * pulling in the Convex server runtime (the same reason companyScope.ts is
 * type-only). See docs/2026-07-25-tenancy-phase2-enforcement-plan.md.
 */

import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export const JNA_ORG_SLUG = "jna";
export const JNA_ORG_NAME = "J&A Business Solutions";

export interface BackfillResult {
  organizationId: Id<"organizations">;
  organizationCreated: boolean;
  companiesLinked: number;
  companiesAlreadyLinked: number;
}

/**
 * Ensure the J&A organization exists and link all unlinked cleaningCompanies to
 * it. Pure w.r.t. time (takes `now`) so it is unit-testable. Idempotent: a
 * second run creates nothing and links nothing.
 */
export async function runJnaOrganizationBackfill(
  ctx: MutationCtx,
  now: number,
): Promise<BackfillResult> {
  const existing = await ctx.db
    .query("organizations")
    .withIndex("by_slug", (q) => q.eq("slug", JNA_ORG_SLUG))
    .first();

  let organizationId: Id<"organizations">;
  let organizationCreated = false;
  if (existing) {
    organizationId = existing._id;
  } else {
    organizationId = await ctx.db.insert("organizations", {
      name: JNA_ORG_NAME,
      slug: JNA_ORG_SLUG,
      status: "active",
      createdAt: now,
    });
    organizationCreated = true;
  }

  const companies = await ctx.db.query("cleaningCompanies").collect();
  let companiesLinked = 0;
  let companiesAlreadyLinked = 0;
  for (const company of companies) {
    if (company.organizationId) {
      companiesAlreadyLinked += 1;
      continue;
    }
    await ctx.db.patch(company._id, { organizationId });
    companiesLinked += 1;
  }

  return {
    organizationId,
    organizationCreated,
    companiesLinked,
    companiesAlreadyLinked,
  };
}
