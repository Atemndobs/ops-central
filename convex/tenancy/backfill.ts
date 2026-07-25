/**
 * Multi-tenancy Phase 2: J&A organization backfill: mutation wrapper.
 *
 * Pure logic (and its unit tests) live in backfillCore.ts. This file only adds
 * the Convex internalMutation entry point.
 *
 * This is a PROD DATA WRITE. It is idempotent and safe to re-run, but running it
 * hits prod:lovable-oriole-182 and needs explicit sign-off. Enforcement
 * (requireOrg wired into queries) is a separate later step and must not turn on
 * until this backfill has run and every cleaningCompanies row is linked.
 *
 * See docs/2026-07-25-tenancy-phase2-enforcement-plan.md.
 */

import { internalMutation } from "../_generated/server";
import { runJnaOrganizationBackfill } from "./backfillCore";

export { JNA_ORG_SLUG, JNA_ORG_NAME } from "./backfillCore";
export type { BackfillResult } from "./backfillCore";

/**
 * Run deliberately (with sign-off) via:
 *   npx convex run tenancy/backfill:backfillJnaOrganization
 * NOTE: that command hits prod:lovable-oriole-182. Do not run without go.
 */
export const backfillJnaOrganization = internalMutation({
  args: {},
  handler: async (ctx) => runJnaOrganizationBackfill(ctx, Date.now()),
});
