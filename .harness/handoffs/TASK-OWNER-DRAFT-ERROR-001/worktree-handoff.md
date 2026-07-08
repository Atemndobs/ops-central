# TASK-OWNER-DRAFT-ERROR-001 — worktree handoff

- Branch: `task/owner-draft-engine-error`
- PR: https://github.com/Atemndobs/ops-central/pull/186
- Schema impact: **none** — no `convex/schema.ts` changes.
- Convex deploy needed after merge: **yes** (query/mutation code changed: `owner/queries.ts`, `owner/mutations.ts`).
- Mobile impact: **cleaners-app mirror required** (`npm run sync:convex-backend`) — no mobile UI/hook changes needed. `useOwnerStatementDraft` already branches on missing `totals` (same union shape `getOwnerDashboard` already returns per property).

## What changed
Fixes the owner property page crashing with "Server Error" for a newly onboarded owner viewing a month before their fee config existed (root cause: `pickFeeConfigForPeriod` throws a plain `Error`, and `getOwnerStatementDraft` was the only owner query that didn't catch it).

- `convex/owner/queries.ts` — `getOwnerStatementDraft` wraps the engine call in try/catch, returns `draft: FeeEngineOutput | { error: string }` (same envelope shape `getOwnerDashboard` already uses per-property)
- `src/components/owner/owner-property-client.tsx` — `"totals" in draft.draft` guard before rendering `OverviewSummaryCard`; friendly notice card on `"error" in draft.draft`
- `convex/lib/effectiveFrom.ts` (new) — pure `firstEffectiveFromMs(earliestCheckInMs, now)` helper
- `convex/owner/mutations.ts` — `upsertPropertyFeeConfig` and `upsertPropertyOwners` backdate `effectiveFrom` to the property's first-activity month, but **only when inserting the first-ever row** for that property (checked via `open.length === 0` / `existing.length === 0`); later upserts keep append-only `effectiveFrom = now`
- `tests/fee-config-period.test.mjs`, `tests/effective-from.test.mjs` (new, `node --test`)

## Verification done in worktree
- `npm test`: 70 pass (+6 new across the two new test files); the 8 failing suites are the pre-existing `origin/main` baseline (guest-reviews, companyScope, mutation-loop-guard, whatsapp/lib, job-status, offline queue, review-access, auth) — confirmed unchanged before/after this branch.
- `npx tsc --noEmit`: 1 pre-existing error (`vitest` module not found in `convex/whatsapp/lib.test.ts`) — present on `origin/main`, not touched here. No new errors.
- `npm run lint`: 51 pre-existing errors on `origin/main`; no new errors in changed files.
- `npm run build`: EXIT 0, compiles clean.
- Confirmed the plan's expected typecheck failure appeared in `owner-property-client.tsx` before the web guard was added (proves the union propagated and the guard was necessary, not redundant).

## Related but NOT in scope here
`Docs/2026-07-04-owner-consistency-plan.md` / PR #185 covers the same user's Team-page/Owner-Overview/Monthly-Close role↔ownership drift — a separate, independent fix. Do not conflate the two PRs.

## Integration steps for main session
1. **First**, run Task 0 from `Docs/2026-07-04-fix-owner-statement-draft-crash.md` (prod data repair — `backdateOwnerSeed` mutation against `rs7892htyjbe7x7yxg39frbqr9853zyb`) if not already done. This unblocks Tataw immediately and is independent of the PR merge.
2. Merge PR #186.
3. `git pull --rebase origin main` in main checkout.
4. `npm run lint && npm run build && npm test` (lint has ~51 pre-existing errors on main; not a gate).
5. Deploy: `export $(grep -v '^#' .env.local | grep PROD_CONVEX_DEPLOY_KEY | xargs); CONVEX_DEPLOY_KEY="$PROD_CONVEX_DEPLOY_KEY" npx convex deploy`
6. Mirror to cleaners: `cd ../jna-cleaners-app && npm run sync:convex-backend`.
7. End-to-end verify: property page loads for `?month=2026-06` (real numbers, post-Task-0 backdate) AND for a month before the property's first stay (notice card, no crash).
8. Write `.harness/handoffs/TASK-OWNER-DRAFT-ERROR-001/integration-result.md`, mark queue entry Done, remove worktree.
