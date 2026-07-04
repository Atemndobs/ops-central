# TASK-OWNER-CONSISTENCY-001 — worktree handoff

- Branch: `task/owner-consistency`
- PR: https://github.com/Atemndobs/ops-central/pull/185
- Schema impact: **backward-compatible** — `portfolioViews.ownerUserId` (optional, no index change, no backfill). Combined-PR exception per `.harness/convex.md`.
- Convex deploy needed after merge: **yes** (schema + query/mutation changes) — main session runs it.
- Mobile impact: **none** (admin/web-only functions; no cleaners-app client calls). Still run `npm run sync:convex-backend` in `jna-cleaners-app` after deploy per standard procedure so the mirrored backend picks up the additive changes.

## What changed
Makes `propertyOwners` the single source of truth for owner↔property across Team page, Owner Overview, and Monthly Close statement views.

- `convex/lib/ownership.ts` (new) — shared active-stake + client-label helpers
- `convex/strCosts/viewResolution.ts` (new) — pure, self-contained view resolver
- `convex/strCosts/views.ts` — `listViews` resolves owner-bound views live; `saveView` gains optional `ownerUserId`; `listStatementClients` refactored to shared helpers
- `convex/admin/queries.ts` — `getTeamMetrics` rows gain `ownedPropertyCount`
- `convex/admin/ownerOverview.ts` — `listOwners` rows gain `unlinked`; lists owner-role users with no stakes
- `convex/schema.ts` — `portfolioViews.ownerUserId` optional field
- `src/app/(dashboard)/team/page.tsx` — "No properties linked" flag (3 layouts)
- `src/app/(dashboard)/admin/owner-overview/page.tsx` — unlinked-owners warning banner
- `src/admin/tools/monthly-close/ViewManager.tsx` — owner-binding picker; unbind on manual edit
- `src/admin/tools/monthly-close/App.tsx` — statement dialog hint for bound views
- `tests/ownership-helpers.test.mjs`, `tests/view-resolution.test.mjs` (new, `node --test`)

## Verification done in worktree
- `npm test`: +7 new tests pass; the 8 failing suites are the pre-existing `origin/main` baseline (guest-reviews, companyScope, mutation-loop-guard, whatsapp/lib, job-status, offline queue, review-access, auth) — none touched here.
- `npm run build`: EXIT 0, all 45 pages generated.
- `npx tsc --noEmit`: no errors in changed files.
- `predeploy` mobile-compat script can't run from the worktree (looks for sibling `../jna-cleaners-app`); main session runs it. Manual grep confirmed no cleaners-app client code calls the changed functions.

## Integration steps for main session
1. Merge PR #185.
2. `git pull --rebase origin main` in main checkout.
3. `npm run lint && npm run build` (lint has ~51 pre-existing errors on main; not a gate).
4. `npm run predeploy` (mobile-compat + searchable-select contract) — now runnable with the sibling present.
5. Deploy: `export $(grep -v '^#' .env.local | grep PROD_CONVEX_DEPLOY_KEY | xargs); CONVEX_DEPLOY_KEY="$PROD_CONVEX_DEPLOY_KEY" npx convex deploy`
6. Mirror to cleaners: `cd ../jna-cleaners-app && npm run sync:convex-backend`.
7. Run manual verification (7 steps) in `Docs/2026-07-04-owner-consistency-plan.md` §Manual verification.
8. Write `integration-result.md`, then remove the worktree.
