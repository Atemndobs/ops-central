# Worktree Handoff

## Task
TASK-FIX-TASKS-001 — Ops tasks not appearing on schedule + assignee avatars on /tasks list

## Type
bugfix + feature (UI) + new Convex queries (additive)

## Branch
task/fix-tasks-feature

## Worktree
~/sites/jnabusiness_solutions/apps-ja/opscentral-admin-fix-tasks (legacy path; user merged from here)

## Base
origin/main

## Status
merged — PR #61 squashed to main as c64bdf8 on 2026-05-02

## What changed

### Bug fix — anchorDate timezone mismatch
- `convex/opsTasks/mutations.ts` stores `anchorDate = Date.UTC(y, m, d)` (UTC midnight).
- `schedule-cell-task-overlay.tsx` and `schedule-date-header-task-overlay.tsx` were reading with `new Date(y, m, d, 0, 0, 0, 0).getTime()` (LOCAL midnight). In any tz ≠ UTC the lookup key never matched the stored key — every task created from a cell vanished from that cell.
- Both overlays now compute `Date.UTC(...)`.
- `task-quick-create-dialog.tsx` prefill reads UTC components from `prefill.anchorDate` so the date input shows the day the user clicked.
- `task-row.tsx` formats the date with `timeZone: "UTC"` so the row label matches the picked day.

### New Convex queries (per architecture.md §2)
- `listGlobalRange(rangeStart, rangeEnd, includeClosed?)` — R2a portfolio drag-across bars on the date-header lane.
- `listAssigneeAvatarsForRange(rangeStart, rangeEnd)` — R6a batched per-cell avatar projection. Replaces N×M `listForCell` round-trips when wired.
- Wiring into `schedule-client.tsx` is intentionally deferred to a follow-up task.

### /tasks list row UX
- `task-row.tsx` renders the assignee's avatar (or initials fallback) at the leading edge with hover-tooltip (`title` + `aria-label`) showing name/email.
- Unassigned tasks render a dashed user-icon placeholder.

## What main should test
1. Create a task from a schedule cell → it appears in that cell immediately and after refresh.
2. /tasks list shows assignee avatars; hover reveals the name. Unassigned shows dashed user icon.
3. Toggle "Assigned to me" → list filters to the current user.
4. Date on /tasks row matches the day picked at creation (no off-by-one for users in tz < UTC).
5. Portfolio task created from the date-header `+` still works.

## Schema impact
none

## Convex impact
**main-dev-once-required.** Two new query exports added; `convex/_generated/api.ts` must be regenerated:

```bash
npx convex dev --once
```

Without this step, importing `api.opsTasks.queries.listGlobalRange` / `listAssigneeAvatarsForRange` from new client code will fail. The current PR does not import them yet, so a stale codegen does not break runtime.

## Commands main should run
- `npm run lint`
- `npm run build`
- `npx convex dev --once`

## Known risks
- Low. The bug fix is a 4-line change (UTC vs local). The new queries are pure additions with no callers yet.
- Tasks that were created **before** this fix will have an `anchorDate` matching whatever convention was in effect at the time. If any task was somehow stored with a non-UTC-midnight value, it will continue to be invisible — but the mutation always normalized via `startOfUtcDay`, so storage was always correct. The bug was on the read side only.

## Rollback plan
- `git revert c64bdf8` — pure UI/query change, no data migration.

## Follow-up tasks (not in this PR)
- Wire `listAssigneeAvatarsForRange` into `schedule-client.tsx` (lift state, pass per-cell summary as prop into overlays).
- "Mine only" / assignee filter on schedule grid (per architecture.md §3b).
- Same toggle on dashboard `<TasksCard />`.
