# Worktree Commands

## Create

```bash
cd /Users/atem/sites/jnabusiness_solutions/apps-ja/opscentral-admin
git fetch origin
git worktree add ~/sites/opscentral-admin-<short-task-name> -b task/<short-task-name> origin/main
cd ~/sites/opscentral-admin-<short-task-name>
npm install
```

Conventions:
- Worktree path: `~/sites/opscentral-admin-<short-task-name>` (always under `~/sites/`, never nested in another project)
- Branch: `task/<short-task-name>` (one task per branch)
- Base: `origin/main` (always)

## Rebase before push

```bash
git fetch origin
git rebase origin/main
# resolve any conflicts
git push --force-with-lease origin task/<short-task-name>
```

Never `git push --force` without `--with-lease`.

## Open PR

```bash
gh pr create --base main --head task/<short-task-name> \
  --title "<conventional commit title>" \
  --body "$(cat <<'EOF'
## Summary
- ...

## Schema impact
none | backward-compatible | schema-first-required | migration-required

## What main should test
- ...

## Handoff
See .harness/handoffs/<TASK-ID>/worktree-handoff.md
EOF
)"
```

## Mark ready

1. Write `.harness/handoffs/<TASK-ID>/worktree-handoff.md` (use template in `.harness/handoffs/README.md`)
2. Edit `.harness/integration-queue.md`, append entry under `## Ready`
3. Commit + push both changes
4. Stop. Wait for main session.

## Close (after main merges)

```bash
cd /Users/atem/sites/jnabusiness_solutions/apps-ja/opscentral-admin
git worktree remove ~/sites/opscentral-admin-<short-task-name>
git branch -D task/<short-task-name>
git push origin --delete task/<short-task-name>
```

## Listing active worktrees

```bash
git worktree list
```

If you see worktrees you don't recognize, they belong to another agent session — leave them alone.
