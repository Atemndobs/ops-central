# Worktree Handoff

## Task
TASK-OWNER-OVERVIEW-PHASE-3

## Type
implementation (UI only — property split view, read-only)

## Branch
feat/admin-owner-overview-split

## Worktree
~/sites/opscentral-admin-owner-overview-split

## Base
origin/main @ a378d0e (post-merge of Phase 2, PR #159)

## PR
https://github.com/Atemndobs/ops-central/pull/160

## Status
ready-for-integration

## What changed
- `src/app/(dashboard)/admin/owner-overview/[ownerId]/properties/[propertyId]/page.tsx` (NEW) — route, reads ownerId+propertyId+?month
- `src/components/admin/owner-overview/PropertySplitView.tsx` (NEW) — split view component, header + LEFT preview + RIGHT editor read-only

## What main should test
1. `npm run build` succeeds
2. Phase 2 dashboard "Open →" link now resolves (previously 404)
3. Period stepper navigates months; current month locks the Next button
4. "Open as owner ↗" opens `/owner/properties/[id]?month=...&preview=admin` in new tab
5. Status pill shows "No draft" when no draft exists for the period

## Schema impact
none

## Convex impact
none — consumes Phase 1 queries

## Commands main should run
- `npm run build`

## Known risks
- Component does not (yet) reuse `OwnerPropertyClient` because it's 1491-line monolithic with hardcoded owner-side queries. Plan §"Component reuse" prefers reuse — pragmatic call for Phase 3 was to render a focused admin view with the same visual conventions (waterfall rows, status pills, period stepper). Phase 4 may revisit if we extract sub-components from `OwnerPropertyClient`.
- Edit controls (checkboxes per row, bucket override dropdown, notes textarea) are intentionally absent — Phase 4 ships those.

## Followups
- Phase 4: BookingsEditor, CostsEditor, VisibilityOverridePanel, StatementStatusPanel + `markReady` + `issueStatement` wrapper
- Phase 5: `autoCreateMonthlyDrafts` cron + `recallStatement` + admin impersonation deep link
