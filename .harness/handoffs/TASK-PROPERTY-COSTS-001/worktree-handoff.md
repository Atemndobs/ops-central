# Worktree Handoff

## Task
TASK-PROPERTY-COSTS-001

## Type
implementation

## Branch
feat/property-costs-editor

## Worktree
~/sites/opscentral-admin-costs

## Base
origin/main @ bfd57a0

## Status
ready-for-integration

## What changed
Adds a per-property cost-line editor — the missing workflow after #179, where
the Monthly Close costs (`propertyCostItems`) were seed-only with no UI.

- **Backend** `convex/strCosts/costItems.ts` (new): `listCostCategories`,
  `listPropertyCostItems`, `createPropertyCostItem`, `updatePropertyCostItem`,
  `deletePropertyCostItem`. Adapted from jna-bs-admin, mapped to OpsCentral's
  schema. No schema change — `propertyCostItems` already exists.
- **Frontend** `src/admin/tools/monthly-close/costs/CostsManager.tsx` (new):
  property picker + inline add/edit/delete table (name, category, frequency,
  amount/%, active). Reuses the local `ui.tsx` primitives; all new markup uses
  `[var(--token)]` classes (named utilities are no-ops here — see #180).
- **Route** `src/app/(dashboard)/reports/costs/page.tsx` (new).
- **Nav** `navigation.ts` + `messages/{en,es}.json` — "Property Costs" entry
  (admin + property_ops).

## What main should test
1. `npx convex dev --once` — **REQUIRED**: regenerates `api` for the new
   `strCosts/costItems` module. Then `npm run sync:convex-backend`.
2. `npm run lint` / `npm run build` (build passes after step 1).
3. Manual: `/reports/costs` → pick property → add a cost line (try a `% of
   revenue` and a `per booking` line) → edit → delete → confirm the Monthly
   Close table + owner statement reflect the change.

## Schema impact
none

## Convex impact
main-dev-once-required (new `strCosts/costItems` functions → regen api; mirror
to cleaners)

## Commands main should run
- npx convex dev --once
- npm run lint
- npm run build

## Merge ordering
Merge **after PR #180** (theme fix). This PR reuses `ui.tsx` but does NOT edit
it — nor any file #180 touches (App/MonthlyPnlTable/ViewManager/HospitableCsvImport/ui).
No conflict either way; ordering just ensures the reused Button/Input/Select
render themed (they're no-op-styled until #180 lands).

## Known risks
- Low. Additive functions + new UI; no schema, no changes to existing files
  except `navigation.ts` + message catalogs.
- `deletePropertyCostItem` is a hard delete (with a `window.confirm`). The
  active toggle (soft disable) is the non-destructive path.

## Rollback plan
- `git revert <merge sha>` — no schema/data impact (deletes are user-initiated).
