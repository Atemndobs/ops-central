/**
 * Multi-tenancy Phase 2: cross-organization isolation primitive (pure).
 *
 * The single gate every scoped query/mutation will route through once
 * enforcement is switched on. Kept pure with type-only imports so `node --test`
 * can exercise the isolation matrix without booting Convex (same reason
 * companyScope.ts / backfillCore.ts are type-only).
 *
 * Enforcement is OFF by default: `assertOrganizationAccess` is a no-op unless
 * `enforced` is true, so wiring it into query paths is safe before the flag is
 * flipped. See docs/2026-07-25-tenancy-phase2-enforcement-plan.md.
 */

import type { Id } from "../_generated/dataModel";

type OrgId = Id<"organizations"> | undefined | null;

/** True when both org ids are present and equal, or both absent. */
export function isSameOrganization(a: OrgId, b: OrgId): boolean {
  return (a ?? null) === (b ?? null);
}

export interface OrgAccessCheck {
  /** Whether tenancy enforcement is currently on (the tenancy_enforced flag). */
  enforced: boolean;
  /** The caller's resolved organization (from resolveCallerOrganization). */
  callerOrgId: OrgId;
  /** The organization that owns the resource being accessed. */
  resourceOrgId: OrgId;
}

/**
 * Central isolation gate.
 *
 * - No-op entirely when `enforced` is false (Phase 2 ships flag OFF).
 * - When enforced and BOTH orgs are known, throws if they differ.
 * - When either org is missing, allows access. This is a deliberate rollout
 *   choice: partially-backfilled/legacy rows (no org yet) must not hard-lock.
 *   Tighten to fail-closed once the backfill is verified complete for every
 *   scoped surface.
 */
export function assertOrganizationAccess(check: OrgAccessCheck): void {
  if (!check.enforced) return;
  const { callerOrgId, resourceOrgId } = check;
  if (!callerOrgId || !resourceOrgId) return;
  if (callerOrgId !== resourceOrgId) {
    throw new Error("Cross-organization access denied.");
  }
}
