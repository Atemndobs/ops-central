# Project Harness — Agent Orchestration Rules

Authoritative rules for how multiple agent sessions (Claude Code, Codex, Cursor, etc.) coordinate work in this repo. Read this before starting any task.

## Roles

Two roles. A session is one or the other, never both at once.

### Main session (integrator)
- Operates in the **main checkout** at `apps-ja/opscentral-admin/` on branch `main`.
- Owns: integration testing, merge sequencing, Convex `dev`/`deploy`, schema deployment, final validation, worktree cleanup.
- Does **not** build feature work directly unless explicitly assigned a task with no parallel sibling.
- Reads `.harness/integration-queue.md` to find ready tasks.

### Worktree session (builder)
- Operates in its own `git worktree` checkout outside `apps-ja/opscentral-admin/`.
- Owns: one branch, one task, one PR, one narrow scope.
- **Forbidden**: editing the main checkout, running `npx convex deploy` / `npx convex dev`, depending on unmerged sibling worktrees, holding a branch open more than ~3 days, modifying unrelated features.

## Worktree lifecycle

```
1. Fetch + create worktree off origin/main
2. Implement single feature
3. Rebase on origin/main before push
4. Open PR
5. Write .harness/handoffs/<TASK-ID>/worktree-handoff.md
6. Append entry to .harness/integration-queue.md
7. Wait for main session
8. Main session merges + tests + deploys Convex if needed
9. Main session writes integration-result.md
10. Worktree deleted: git worktree remove <path>; git branch -D <branch>
```

## Rebase discipline

- Rebase on `origin/main` before pushing.
- Rebase on `origin/main` before opening a PR.
- Rebase whenever main session announces a merge that touches your area.
- If a rebase produces non-trivial conflicts, your branch is too old — finish fast or split.

## Branch lifetime

- Target: < 3 days from worktree creation to PR merge.
- One feature per worktree. No stacking.
- No cross-worktree dependencies on unmerged work.

## Forbidden actions (worktree)

- `git checkout` in the main checkout
- Editing files in `apps-ja/opscentral-admin/` directly
- `npx convex deploy`
- `npx convex dev` (any form against shared deployment)
- `npx convex codegen` against shared deployment
- Depending on a sibling worktree's unmerged branch
- Force-pushing to `main`
- Merging your own PR (main session merges)

## Handoff protocol

A worktree is **ready** only when all four exist:
1. PR opened against `main`
2. `.harness/handoffs/<TASK-ID>/worktree-handoff.md` written
3. Entry added to `.harness/integration-queue.md` under `## Ready`
4. CI green (or explicit note if CI not applicable)

Until all four exist, the main session does nothing.

## Main session integration protocol

```bash
cd /Users/atem/sites/jnabusiness_solutions/apps-ja/opscentral-admin
git fetch origin
git checkout main
git pull --rebase origin main
# review PR, merge via gh pr merge
git pull --rebase origin main
npm run lint && npm run build
# only if schema-impact != none:
npx convex dev --once
# write integration-result.md
# remove from integration-queue.md ## Ready, append to ## Done
```

## See also

- `.harness/convex.md` — Convex command ownership and schema migration policy
- `.harness/worktrees.md` — exact commands for worktree create/close
- `.harness/integration-queue.md` — current queue of ready tasks
- `.harness/handoffs/README.md` — handoff file template
- `.harness/routing.md`, `.harness/provider-contract.md`, `.harness/current-session.md` — global ATEM provider-routing layer (separate concern from this project protocol)
