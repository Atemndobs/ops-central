# Integration Queue

Ready-for-integration tasks. Worktree sessions append to `## Ready`. Main session moves to `## Done` after merge.

## Ready

_None yet._

## In progress (main session integrating)

_None yet._

## Done

_None yet._

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
