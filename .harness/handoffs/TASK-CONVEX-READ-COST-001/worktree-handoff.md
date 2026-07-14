# Worktree Handoff

## Task
TASK-CONVEX-READ-COST-001

## Type
refactor (perf)

## Branch
task/convex-read-cost

## Worktree
~/sites/opscentral-admin-read-cost

## Base
origin/main @ 3a76d10

## Status
ready-for-integration

## What changed
- `convex/stays/queries.ts` — `getInDateRange` now uses a two-sided `by_checkin`
  range `[from - MAX_STAY_MS(180d), to)` instead of `by_checkout` lower-bound-only.
  Reads bounded to the visible window + fixed lookback. Same result set.
- `convex/serviceUsage/convexSnapshot.ts` — dropped fast-growing append-only
  tables from the row-count scan (serviceUsageEvents, serviceUsageRollups,
  conversationMessages, photos); per-table cap 50k→10k.
- `convex/crons.ts` — convex self-report cron daily→weekly (renamed
  `service-usage-convex-snapshot-daily` → `-weekly`, `0 2 * * 0`).

## What main should test
1. `npm run lint && npm run build` clean.
2. Schedule → Occupancy view still renders reservations for the current
   week/month (result set unchanged; only the read bound changed).
3. After deploy, confirm the old `service-usage-convex-snapshot-daily` cron is
   gone and `-weekly` is registered (Convex dashboard → Schedules).

## Schema impact
none

## Convex impact
deploy-required (changed function bodies + cron schedule; no new queries, so no
api.ts regen needed). Mirror to cleaners with `npm run sync:convex-backend`.

## Commands main should run
- npm run lint
- npm run build
- npx convex deploy   (owner path, from main checkout — pushes to lovable-oriole-182)

## Known risks
- low. `stays` fix could miss a single reservation longer than 180 days that is
  already ongoing before the window — a non-case for STR/corporate housing.
- `convexSnapshot` loses per-table row-count gauges for the 4 dropped tables on
  `/settings/usage`; `convex_events_24h` + Convex dashboard remain.

## Rollback plan
- git revert the merge commit + redeploy. No data cleanup (no schema/migration).

## Follow-up (NOT in this PR)
- PR 2: denormalized unread-conversation counter for `getUnreadConversationCount`
  / `listMyConversations` (dominant offender). Design in
  `Docs/2026-07-14-convex-read-cost-audit.md`. Schema-first.
- `opsTasks.listAssigneeAvatarsForRange` `draggingIn` unbounded past-scan —
  harmless while `opsTasks` empty; bound before it grows.
