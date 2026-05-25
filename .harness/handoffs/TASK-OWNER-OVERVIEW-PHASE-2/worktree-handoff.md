# Worktree Handoff

## Task
TASK-OWNER-OVERVIEW-PHASE-2

## Type
implementation (UI only — index + dashboard pages)

## Branch
feat/admin-owner-overview-ui

## Worktree
~/sites/opscentral-admin-owner-overview-ui

## Base
origin/main @ 8255758 (post-merge of Phase 1, PR #150)

## PR
https://github.com/Atemndobs/ops-central/pull/159

## Status
ready-for-integration

## What changed
- `src/app/(dashboard)/admin/owner-overview/page.tsx` (NEW) — owners index, calls `api.admin.ownerOverview.listOwners`
- `src/app/(dashboard)/admin/owner-overview/[ownerId]/page.tsx` (NEW) — per-owner dashboard, calls `api.admin.ownerOverview.getOwnerDashboard`
- `src/components/layout/navigation.ts` — new entry between Team and Inventory, `admin` + `property_ops`
- `src/components/layout/header.tsx` — page title map entry
- `src/messages/{en,es}.json` — `nav.ownerOverview`

## What main should test
1. `npm run build` succeeds
2. Sidebar shows "Owner Overview" as admin/property_ops; hidden for cleaner/manager
3. `/admin/owner-overview` lists owners with summary counters
4. `/admin/owner-overview/[ownerId]` renders dashboard
5. Clicking a property link 404s — intentional, Phase 3 lands the property route

## Schema impact
none

## Convex impact
none — Phase 1 queries already deployed

## Commands main should run
- `npm run lint` (pre-existing errors expected)
- `npm run build`

## Known risks
- Phase 3 will replace the per-owner dashboard's "Open" links with the real split view. Until then, those links route to a 404.
- Pre-existing lint error in `src/components/layout/header.tsx:229` (set-state-in-effect) — unchanged by this PR.

## Followups
- Phase 3: `/admin/owner-overview/[ownerId]/properties/[propertyId]` split view (read-only preview)
- Phase 4: editor + `markReady` + `issueStatement` wrapper
- Phase 5: cron + recall
