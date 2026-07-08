# Worktree Handoff

## Task
TASK-MANAGER-SCOPE-001 — Manager dispatch scoping (Convex-only, R1.1–R5)

## Type
feature (server-side authorization) + refactor + tests

## Branch
claude/gracious-borg-3d5a6e

## Worktree
~/sites/jnabusiness_solutions/apps-ja/opscentral-admin/.claude/worktrees/gracious-borg-3d5a6e

## Base
origin/main @ baffa461

## Status
ready-for-integration

## What changed

Convex-only — backend authorization for the manager role. Closes the
gap where a manager in one cleaning company could see/modify another
company's data (R3 defense in depth, R5 acceptance scenarios 1, 3, 6).

Eight commits, see [Docs/manager-scope-gap-list.md](../../../Docs/manager-scope-gap-list.md)
for the full audit and [PLAN.md in worktree `manager-scope`](../../../../../opscentral-admin-manager-scope/PLAN.md).

1. `99db69e` Extract `convex/lib/companyScope.ts` — single source of truth
   for the membership + property-assignment join walk. Removes 130
   duplicated lines across 3 files.
2. `50dd700` Role-gate fixes per R7.4:
   - `cleaningJobs.create` → admin + property_ops only (was unguarded).
   - `assertReviewerRole` → admin + property_ops (was manager + ops; admin
     was locked out — appears to have been an oversight).
3. `946c019` `users.getCleaners` rewritten off `companyMembers` to pick up
   cleaner-manager hybrids per R1.1. Admin/ops paths unchanged.
4. `810af80` Direct-ID guards on `cleaningJobs.getById`,
   `cleaningJobs.getMyJobDetail`, `properties.getById`. Closes R5 #3.
5. `971b5ae` List queries scoped: `properties.list/getAll/search/
   getMyAccessibleProperties`, `cleaningJobs.getInDateRange/
   getForCleaner/countByCleaner/getAssignable`.
6. `a9adf57` Chip counters scoped (`getStatusCounts`); admin-only gate on
   `getSchedulingMetrics`.
7. `132d385` `getManagerDashboard` axis fix: `assignedManagerId` →
   `companyProperties`. Also stops reading the entire jobs table for
   managers.
8. `d8b2b53` 15 unit tests for `companyScope.ts` (node:test + minimal
   ctx fake — no convex-test dep).

## What main should test

Smoke (no real second company, per "skip seed for now" decision):

1. Sign in as Sofia manager (Jesse): Team / Jobs / Schedule / Properties
   should all show only Sofia data (no errors, no empty lists).
2. Sign in as admin: dashboards behave as before (no regression).
3. Direct URL load `/jobs/<id>` for a Sofia job as Jesse → 200.
4. Approve a submission as ops/admin → still works.
5. Try `cleaningJobs.create` from chat tool (if exposed) or directly →
   admin/ops succeed, manager rejected.

Pure-correctness checks: `npx tsx --test convex/lib/companyScope.test.ts`
→ 15/15 pass.

## Schema impact
none — only handler logic changed.

## Convex impact
deploy-required. Manager-facing surfaces will start enforcing scope
the instant the deploy lands. Sofia Cleaning manager (Jesse) is the
only currently-active manager on prod — verify his session post-deploy.

## Commands main should run
- `npm run lint`
- `npm run build`
- `npx tsc --noEmit -p convex/tsconfig.json`
- `npx tsx --test convex/lib/companyScope.test.ts`
- `npx convex deploy` (US prod `lovable-oriole-182`)
- `cd ../../jna-cleaners-app && npm run sync:convex-backend`

## Known risks

- `users.getManagerDashboard` axis change means the dashboard count
  values will jump for any manager whose `companyProperties` differs
  from the legacy `assignedManagerId` set. Sofia today: Jesse should
  see a richer dashboard (his company has properties; the old
  filter was usually empty).
- `assertReviewerRole` flip: any UI today that relied on managers
  seeing `/review` will stop working for them. Per R7.4 that's intended.
- `properties.list/search/getAll` now return `[]` for a manager with
  no active manager/owner membership — fail-closed is the contract,
  but UIs should degrade to an empty-state, not crash. Smoke check.

## R5 acceptance status

- #1 Manager A scoped view → enforced
- #2 Disjoint Manager B view → deferred (no 2nd company on prod yet)
- #3 Direct-URL block → enforced (and unit-tested)
- #4 Assign → cleaner sees job → already passing pre-task
- #5 Manager-as-cleaner own dashboard → unchanged paths, expected to pass
- #6 No cross-company query success in logs → all surfaces now gated
