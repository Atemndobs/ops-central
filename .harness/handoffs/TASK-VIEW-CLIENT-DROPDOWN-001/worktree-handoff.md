# Worktree Handoff

## Task
TASK-VIEW-CLIENT-DROPDOWN-001

## Type
implementation

## Branch
feat/view-client-owner-dropdown

## Worktree
~/sites/opscentral-admin-client-dropdown

## Base
origin/main @ 12d9fb7

## Status
ready-for-integration

## What changed
Makes the saved-view "Client / company (for statements)" field a **dropdown of
the owners we manage** instead of free text.

- **Backend** `convex/strCosts/views.ts`: new `listStatementClients` query —
  one row per owner-user with an active stake (`effectiveTo === undefined`),
  including the property ids they hold. **Added to the existing `views`
  module**, so the generated `api` already imports it via `typeof` — NO regen
  needed, web build stays green (deliberately avoids the #181 codegen-ordering
  trap).
- **Frontend** `src/admin/tools/monthly-close/ViewManager.tsx`: clientName
  `Input` → `Select` of owners. Picking an owner sets the client AND scopes the
  view to that owner's properties; checkboxes stay editable. A pre-existing
  custom value is preserved as a `(custom)` option; "None" clears the client
  only.

## What main should test
1. Merge → `npx convex deploy` (prod) → `npm run sync:convex-backend`.
2. `npm run lint` / `npm run build` (both pass now — no api gap).
3. Manual: New view → Client/company dropdown lists owners → pick one → its
   properties auto-check → Save → Export PDF → "Statement Prepared For: {owner}".

## Schema impact
none

## Convex impact
**convex-deploy-required** — `npx convex deploy` to prod `lovable-oriole-182` so
`listStatementClients` resolves at runtime. The web build is green WITHOUT regen
(new query is on the existing `views` module). Deploy Convex right after merge to
avoid a transient "unknown function" error during the gap.

## Commands main should run
- (merge)
- npx convex deploy            # prod — REQUIRED for the dropdown to populate
- npm run sync:convex-backend
- npm run lint && npm run build

## Known risks
- Low. One additive query + one field swapped from input to select.
- If the web deploy lands before `npx convex deploy`, the owners query throws
  "unknown function" until Convex is deployed → deploy Convex first/immediately.
- Owner display name = `users.name` (falls back to email). No separate company
  field exists on `users`; an owner row whose name is a company shows that name.

## Rollback plan
- `git revert <merge sha>` — no schema/data impact (the query is read-only; the
  field reverts to free text).
