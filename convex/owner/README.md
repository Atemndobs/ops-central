# Convex `owner/` — Property Owner Portal subsystem

This directory holds queries, mutations, and actions for the owner-facing
product surface. **Wave 1 is schema-only** — the tables defined here exist in
`convex/schema.ts` but have no callable functions yet.

## Spec
- Design: `docs/superpowers/specs/2026-05-22-property-owner-portal-design.md`
- Wave plan: `docs/superpowers/plans/2026-05-22-property-owner-portal-plan.md`

## Tables (Wave 1)
- Ported from archive: `manualAdjustments`, `capitalExpenditures`,
  `costCategories`, `costItems`, `costTemplates`, `propertyCostItems`,
  `monthlyCalculations`, `propertyMonthlySettings`
- Net-new for owner portal: `propertyOwners`, `propertyFeeConfig`,
  `ownerStatements`, `maintenanceApprovalRequests`, `ownerDateBlocks`,
  `ownerNotificationPrefs`

## Canonical constants
- `constants.ts` — `BUCKETS` array + `Bucket` type + `isBucket()` guard.
  Until the post-Wave-2 narrowing PR, every writer to
  `costCategories.bucket` MUST validate via `isBucket(value)` at the
  mutation boundary.

## Coming in later waves
- Wave 2: cost-data backfill (one-time mutation, then PR to narrow
  `costCategories.bucket` to required).
- Wave 3: fee engine + queries (`getOwnerStatementDraft`,
  `issueOwnerStatement`, `decideMaintenanceApprovalRequest`, etc.).
- Wave 4: `/owner/*` web routes.
- Wave 5: `(owner)` mobile route group.

## Deployment ownership
This Convex backend is owned by `opscentral-admin`. **NEVER** run
`npx convex deploy` from `jna-cleaners-app`. See workspace `CLAUDE.md`.
