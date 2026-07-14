# Convex Command Ownership

## The hard rule

Only the **main session** in `apps-ja/opscentral-admin/` runs Convex commands against shared deployments.

Worktree sessions never run:
- `npx convex deploy`
- `npx convex dev`
- `npx convex dev --once`
- `npx convex codegen` (against shared deployment)
- `npx convex import` / `npx convex export`

Worktree sessions may:
- Edit files under `convex/` (schema, queries, mutations, actions)
- Read `convex/_generated/` (already committed types)
- Run `convex/` unit tests if they don't hit the live deployment

## Why

`ja-bs.com` runs on the Convex deployment labeled "Development" (`usable-anaconda-394`). Two worktrees running `convex dev` would race-overwrite each other's schema and break live users immediately. Centralizing Convex commands in the main session serializes deploys.

See `CLAUDE.md` → "VERY IMPORTANT: ja-bs.com RUNS ON THE *DEV* CONVEX DEPLOYMENT" for the full deployment story.

## Schema migration policy

### Default: schema-first

For any change that is **not** trivially backward-compatible, ship the schema as its own PR, merge it, deploy from main, then rebase the feature worktree.

Schema-first is required for:
- New required fields
- Renames or type changes on existing fields
- New indexes that affect query plans
- Removing fields or tables
- Any change that breaks existing queries
- Any data backfill or migration script

Sequence:
```
1. Worktree A creates schema-only PR (TASK-XXX-schema)
2. Main merges + npx convex dev --once
3. Worktree B (feature, possibly same agent later) rebases on main
4. Worktree B builds feature against deployed schema
5. Worktree B PR merges
```

### Exception: schema + feature in one PR

Allowed only if **all** are true:
- New field is optional (no required default)
- No existing query/mutation breaks
- No data migration or backfill needed
- Rollback is `git revert` + redeploy (no data cleanup)
- Both apps (web + mobile) still build against the new schema

If unsure → schema-first.

## Owner repo path

```bash
cd /Users/atem/sites/jnabusiness_solutions/apps-ja/opscentral-admin
npx convex <command>
```

`jna-cleaners-app` mirrors backend via `npm run sync:convex-backend` after main session deploys.
`jna-bs-admin` is isolated and must not be re-coupled to this deployment.

## Schema-impact field in handoff

Every `worktree-handoff.md` declares `Schema impact:` as one of:

- `none` — no `convex/schema.ts` changes
- `backward-compatible` — additive optional fields only, eligible for combined PR
- `schema-first-required` — must ship as separate PR before feature
- `migration-required` — needs a backfill script; coordinate live with main session

## Read-cost gate (added 2026-07-14 after the 10.66 GB incident)

Convex bills reads by documents SCANNED; reactive queries re-run on every write to
their read set. Full rules: `convex/CLAUDE.md`. Full story:
`Docs/2026-07-14-convex-database-optimization-playbook.md`.

**Main session (integrator), before every Convex deploy:**

```bash
npm run check:convex-readcost   # fails on any NEW scan/filter/giant-take vs baseline
```

**Any PR touching `convex/` must state in its description:**
1. Which indexes each new/changed query uses, and the range bounds.
2. What subscribes to it (reactive vs one-shot) and from which components.
3. If it raises the read-cost baseline: why, with explicit human sign-off.

**Worktree sessions:** run the checker before opening the PR. A baseline increase
without justification is grounds for the integrator to bounce the handoff.

**Weekly (5 min):** dashboard → Usage → last 7 days → Database I/O breakdown by
function. Any function >200 MB/week gets a ticket. Spot-check doc sizes with
`npx convex data <table> --limit 8 --format jsonl` (never the pretty format).
