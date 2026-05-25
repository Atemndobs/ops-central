# Worktree Handoff

## Task
TASK-OWNER-OVERVIEW-PHASE-1

## Type
implementation (schema + queries + mutation, no UI)

## Branch
feat/admin-owner-overview

## Worktree
~/sites/opscentral-admin-owner-overview

## Base
origin/main @ 4c611e06

## PR
https://github.com/Atemndobs/ops-central/pull/150

## Status
ready-for-integration

## What changed
- `convex/schema.ts` — widen `ownerStatements.status` union (adds `ready|sent|recalled`); add additive optional fields: `overrides`, `excludedStayIds`, `excludedCostItemIds`, `costBucketOverrides`, `notes`, `auditTrail`
- `convex/admin/ownerOverview.ts` (NEW) — `listOwners`, `getOwnerDashboard`, `getPropertyPreview` queries + `upsertDraft` mutation, all admin/property_ops gated
- `convex/owner/engineInputs.ts` (NEW) — shared `loadEngineInputs` helper extracted from `owner/queries.ts` + `owner/mutations.ts` (drift mitigation per plan §Risks)
- `convex/owner/queries.ts` + `convex/owner/mutations.ts` — refactored to import the shared helper, no behavior change

## What main should test
1. `npx tsc --noEmit -p convex` passes (already verified in worktree)
2. `npx convex dev --once` against prod (`lovable-oriole-182`) deploys cleanly
3. Existing `/owner/*` routes still render — owner queries were refactored only to import the shared loader, no behavior change
4. (Optional) `npx convex run admin/ownerOverview:listOwners` returns sane rows
5. Cleaners app mirror via `npm run sync:convex-backend` — schema is backward-compatible so the cleaners app should still build

## Schema impact
backward-compatible

All new fields are `v.optional(...)`. The status union was widened (a superset of the previous values), so every existing row still validates. No data migration needed.

## Convex impact
main-dev-once-required (to push the new schema + functions)

## Commands main should run
- `npm run lint` (pre-existing errors expected; touched files are clean)
- `npm run build`
- `npx convex dev --once`
- (after deploy) `cd ../jna-cleaners-app && npm run sync:convex-backend`

## Known risks
- The `getPropertyPreview` query returns `preview: null` (instead of throwing) when the engine can't run (missing fee config etc.). This is intentional — UI for Phase 3 needs an empty-state, not a 500. Phase 4 may want stricter behavior.
- `upsertDraft` re-computes the snapshot every call. For a property with thousands of stays/costs, this can be slow. Phase 5 may add a `noRecompute` flag for cron-driven bulk creates.

## Followups (later phases — NOT in this PR)
- Phase 2: `/admin/owner-overview` + `/admin/owner-overview/[ownerId]` pages
- Phase 3: property split view (read-only preview)
- Phase 4: editor components + `markReady` + `issueStatement` wrapper
- Phase 5: `autoCreateMonthlyDrafts` cron + `recallStatement`
