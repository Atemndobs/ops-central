# Integration Queue

Ready-for-integration tasks. Worktree sessions append to `## Ready`. Main session moves to `## Done` after merge.

## Ready

### TASK-OWNER-OVERVIEW-PHASE-1
- Branch: feat/admin-owner-overview
- Worktree: ~/sites/opscentral-admin-owner-overview
- PR: https://github.com/Atemndobs/ops-central/pull/150
- Schema impact: backward-compatible
- Convex impact: main-dev-once-required (deploy new schema fields + admin/ownerOverview module)
- Risk: low (additive schema, queries gated, no callers yet)
- Ready since: 2026-05-25
- Handoff: .harness/handoffs/TASK-OWNER-OVERVIEW-PHASE-1/worktree-handoff.md

### TASK-MANAGER-SCOPE-001
- Branch: claude/gracious-borg-3d5a6e
- Worktree: ~/sites/jnabusiness_solutions/apps-ja/opscentral-admin/.claude/worktrees/gracious-borg-3d5a6e
- PR: pending
- Schema impact: none
- Convex impact: deploy-required
- Risk: medium (auth surface — flips manager behavior on prod)
- Ready since: 2026-05-17 23:55 UTC+2
- Handoff: .harness/handoffs/TASK-MANAGER-SCOPE-001/worktree-handoff.md

## In progress (main session integrating)

_None yet._

## Done

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
