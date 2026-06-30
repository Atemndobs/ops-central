# Worktree Handoff

## Task
TASK-OWNER-COMPANY-001

## Type
implementation

## Branch
feat/owner-company-statement

## Worktree
~/sites/opscentral-admin-owner-company

## Base
origin/main @ 2586ac7

## Status
ready-for-integration

## What changed
Statement client now prints the owner's **company** when set, else their **name**.

- `convex/schema.ts`: add optional `users.company`. Additive; `Doc<"users">`
  auto-types via `typeof schema` (dataModel.d.ts derives from the schema), so
  **no `_generated` regen** and the web build stays green.
- `convex/strCosts/views.ts` `listStatementClients`: returns `company` + `client`
  (= `company ?? name`) + `name`. (Existing module → no api regen.)
- `src/admin/tools/monthly-close/ViewManager.tsx`: dropdown value = `client`
  (what prints on the statement); option label = `Company (Rep) · N properties`.
- `convex/admin/mutations.ts`: `updateUser` accepts optional `company`; new
  `internalMutation setOwnerCompanyByEmail` (ops one-off backfill).

## What main should test
1. Merge → `npx convex deploy` (prod) → `npm run sync:convex-backend`.
2. `npm run lint` / `npm run build` (green — no regen needed).
3. One-off data: `npx convex run admin/mutations:setOwnerCompanyByEmail '{"email":"rchabeja@gmail.com","company":"J&A Business Solutions LLC"}'` (prod).
4. Manual: New view → Client dropdown shows "J&A Business Solutions LLC (Randalls) · 7 properties" → pick → Export PDF → "Statement Prepared For: J&A Business Solutions LLC".

## Schema impact
backward-compatible (additive optional `users.company`; shared schema — safe for cleaners app)

## Convex impact
convex-deploy-required (schema field + functions to prod `lovable-oriole-182`; mirror to cleaners). Web build green without regen.

## Commands main should run
- (merge)
- npx convex deploy
- npx convex run admin/mutations:setOwnerCompanyByEmail '{"email":"rchabeja@gmail.com","company":"J&A Business Solutions LLC"}'
- npm run sync:convex-backend
- npm run lint && npm run build

## Known risks
- Low. Additive optional field + read query shape change + one mutation arg.
- Existing saved views with a `clientName` that was the owner's *name* (not
  company) keep working — they show as a "(custom)" option until re-picked.

## Follow-ups (NOT in this PR)
- In-app company editor (team-page "Company" field — `updateUser` already
  accepts it).
- Add **Tataw John** as owner of the Litchfield Park "Luxurious Family-Friendly
  3BR Escape" (needs his email + login-vs-statement-only decision).

## Rollback plan
- `git revert <merge sha>` — additive field, no data cleanup needed.
