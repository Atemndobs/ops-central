# Integration Queue

Ready-for-integration tasks. Worktree sessions append to `## Ready`. Main session moves to `## Done` after merge.

## Ready

_None._

## In progress (main session integrating)

_None._

## Done

### TASK-OWNER-OVERVIEW-PHASE-3
- Branch: feat/admin-owner-overview-split
- Worktree: ~/sites/opscentral-admin-owner-overview-split
- PR: https://github.com/Atemndobs/ops-central/pull/160 (merged)
- Schema impact: none
- Convex impact: none (consumes Phase 1 queries)
- Risk: low (UI-only, additive route)
- Merged: 2026-05-25
- Handoff: .harness/handoffs/TASK-OWNER-OVERVIEW-PHASE-3/worktree-handoff.md

### TASK-OWNER-OVERVIEW-PHASE-2
- Branch: feat/admin-owner-overview-ui
- Worktree: ~/sites/opscentral-admin-owner-overview-ui
- PR: https://github.com/Atemndobs/ops-central/pull/159 (merged)
- Schema impact: none
- Convex impact: none (consumes Phase 1 queries)
- Risk: low (UI-only, admin-gated nav)
- Merged: 2026-05-25
- Handoff: .harness/handoffs/TASK-OWNER-OVERVIEW-PHASE-2/worktree-handoff.md

### TASK-OWNER-OVERVIEW-PHASE-1
- Branch: feat/admin-owner-overview
- Worktree: ~/sites/opscentral-admin-owner-overview
- PR: https://github.com/Atemndobs/ops-central/pull/150 (merged)
- Schema impact: backward-compatible
- Convex impact: main-dev-once-required (deploy new schema fields + admin/ownerOverview module)
- Risk: low (additive schema, queries gated, no callers yet)
- Merged: 2026-05-25
- Handoff: .harness/handoffs/TASK-OWNER-OVERVIEW-PHASE-1/worktree-handoff.md

### TASK-MANAGER-SCOPE-001
- Branch: claude/gracious-borg-3d5a6e
- Worktree: ~/sites/jnabusiness_solutions/apps-ja/opscentral-admin/.claude/worktrees/gracious-borg-3d5a6e
- PR: https://github.com/Atemndobs/ops-central/pull/77 (merged) — follow-ups: #92, #95, #96
- Schema impact: none
- Convex impact: deploy-required
- Risk: medium (auth surface — flips manager behavior on prod)
- Merged: 2026-05-17
- Handoff: .harness/handoffs/TASK-MANAGER-SCOPE-001/worktree-handoff.md

### TASK-FIX-TASKS-001
- Branch: task/fix-tasks-feature
- Worktree: ~/sites/jnabusiness_solutions/apps-ja/opscentral-admin-fix-tasks
- PR: https://github.com/Atemndobs/ops-central/pull/61 (merged → c64bdf8)
- Schema impact: none
- Convex impact: main-dev-once-required (`npx convex dev --once` to regen api.ts for new queries)
- Risk: low
- Merged: 2026-05-02 18:34 UTC
- Handoff: .harness/handoffs/TASK-FIX-TASKS-001/worktree-handoff.md

---

## Entry format

```markdown
### TASK-<ID>
- Branch: task/<name>
- Worktree: ~/sites/opscentral-admin-<name>
- PR: <url>
- Schema impact: none | backward-compatible | schema-first-required | migration-required
- Convex impact: none | main-dev-once-required | deploy-required
- Risk: low | medium | high
- Ready since: YYYY-MM-DD HH:MM
- Handoff: .harness/handoffs/TASK-<ID>/worktree-handoff.md
```
