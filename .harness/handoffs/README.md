# Handoff Files

One folder per task: `.harness/handoffs/<TASK-ID>/`.

## Required files

### `worktree-handoff.md` (written by worktree session)

```markdown
# Worktree Handoff

## Task
TASK-<ID>

## Type
implementation | bugfix | refactor | schema-only | docs

## Branch
task/<name>

## Worktree
~/sites/opscentral-admin-<name>

## Base
origin/main @ <sha>

## Status
ready-for-integration

## What changed
- ...

## What main should test
1. ...
2. ...

## Schema impact
none | backward-compatible | schema-first-required | migration-required

## Convex impact
none | main-dev-once-required | deploy-required

## Commands main should run
- npm run lint
- npm run build
- (if applicable) npx convex dev --once

## Known risks
- ...

## Rollback plan
- git revert <sha> (and any data cleanup if migration-required)
```

### `integration-result.md` (written by main session, after merge)

```markdown
# Integration Result

## Task
TASK-<ID>

## Merged at
YYYY-MM-DD HH:MM

## Merge sha
<sha>

## Tests run
- npm run lint: pass | fail
- npm run build: pass | fail
- Manual: ...

## Convex
- Deployed: yes | no
- Command: npx convex dev --once

## Issues found
- ...

## Status
integrated | reverted | needs-followup
```

## Optional files

- `test-plan.md` — detailed manual test steps if more than ~5
- `schema-impact.md` — schema diff + migration notes for `migration-required` tasks
- `merge-notes.md` — anything tricky about the merge order
