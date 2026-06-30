# Worktree Handoff

## Task
TASK-MONTHLY-CLOSE-001

## Type
implementation

## Branch
task/monthly-close

## Worktree
~/sites/opscentral-admin-monthly-close

## Base
origin/main @ f46f9d0

## Status
ready-for-integration

## What changed
Ports the **Monthly Close engine + ChezSoi "Chez Soi Stays" Owner Statement**
from the archived `jna-bs-admin` repo (deployed + validated there against real
Mercury/Hospitable data) into OpsCentral.

Backend topology decision: OpsCentral's Convex (`lovable-oriole-182`) is a
**separate deployment** from jna-bs-admin's (`whimsical-lemur-800`), so the
engine + functions were replicated. OpsCentral **already had** the cost tables
(`costCategories`, `costItems`, `propertyCostItems`, `monthlyCalculations`,
`propertyMonthlySettings`) from the owner-portal fee engine, so the schema delta
is small.

**Schema (`convex/schema.ts`)**
- `properties.status` — new optional `"active" | "dropped" | "managed"`. Engine
  derives status from `isActive` when absent (no backfill needed).
- `portfolioViews` — new table (`name`, optional `clientName`, `propertyIds`).

**Backend (`convex/strCosts/`)** — all new files
- `costMath.ts` — pure deterministic engine (verbatim from source).
- `buckets.ts` — **new adapter**: maps OpsCentral's 13-bucket `costCategories.bucket`
  vocabulary → the engine's 7-bucket set. Without it the statement cost pie would
  render `NaN` (the one real incompatibility between the two apps).
- `portfolio.ts` — `portfolioReport` (deterministic recompute, gross basis).
- `reports.ts` — `resolvePropertyReportData` + `portfolioStatementData`
  (the `propertyReports`-table save/list functions were dropped — OpsCentral has
  no such table and the page doesn't need them).
- `views.ts` — `listViews` / `saveView` / `deleteView` (verbatim).
- `queries.ts` — `getProperties` (small list for the view manager / importer).
- `mutations.ts` — `saveHospitableImportItems` (non-destructive re-import) +
  `setMonthlyActual` (manual off-platform entry).
- `costMath.test.ts` — golden test rewritten in OpsCentral's `node:test` idiom.

**Frontend (`src/admin/tools/monthly-close/`)** — new module
- `App.tsx`, `MonthlyPnlTable.tsx`, `ViewManager.tsx` — **rewritten** in
  OpsCentral's hand-rolled Tailwind idiom (the app has no shadcn/ui; source used it).
- `ui.tsx` — small local primitives (Button/Input/Label/Select/Switch/Checkbox/Modal)
  using the app's semantic tokens. Self-contained; no new global UI framework.
- `HospitableCsvImport.tsx` — **new** client-side CSV importer: parses in-browser
  via `parseHospitableCSV` and calls `saveHospitableImportItems` directly with
  `useMutation` (replaces jna-bs-admin's two Next.js API routes — none ported).
- `statement/{chezSoiBrand.ts, buildStatementHtml.ts}` — verbatim (pure). Brand
  tokens kept as-is (already the canonical ChezSoi purple `#9b51e0`); the inlined
  base64 logo is required for the `window.open`+`document.write` print context.
- `lib/{format,portfolioReportCsv,portfolioReportPrint,hospitableParser}.ts` — verbatim.

**Route + nav**
- `src/app/(dashboard)/reports/monthly-close/page.tsx` — new route.
- `navigation.ts` + `messages/{en,es}.json` — "Monthly Close" nav item
  (`nav.monthlyClose`, roles admin + property_ops), icon `Calculator`.

## What main should test
1. `npx convex dev --once` (or `deploy`) — **REQUIRED**: regenerates
   `convex/_generated/api.*` so the frontend's `api.strCosts.*` references
   resolve, and deploys `properties.status` + `portfolioViews`.
2. `npm run lint` — expect 0 errors (1 pre-existing-style warning in the verbatim
   `buildStatementHtml.ts`: unused `period` in a nested scope).
3. `npm run build` — passes only **after** step 1 (api types must exist first).
4. `node --test convex/strCosts/costMath.test.ts` — 9/9 pass; reproduces
   `reports/2026/june/portfolio_june_2026.csv` (Lisboa +$2,101.30; portfolio
   15,439.63 / 12,876.65 / 2,562.98 / 16.6%).
5. Manual: open `/reports/monthly-close`, pick a month, "Export PDF" → statement
   opens ChezSoi-branded ("Statement Prepared For: {clientName}"), no-data rows
   muted + excluded from totals.

## Schema impact
backward-compatible (additive optional `properties.status` + new `portfolioViews`
table; no migration, no breaking query; rollback = `git revert`)

## Convex impact
main-dev-once-required (`npx convex dev --once` to deploy the additive schema +
regenerate the `api` types for the new `strCosts/*` modules; then mirror to the
cleaners app via `npm run sync:convex-backend`)

## Commands main should run
- npx convex dev --once   # schema + codegen FIRST
- npm run lint
- npm run build
- node --test convex/strCosts/costMath.test.ts

## Known risks
- **Bucket mapping (`buckets.ts`)** is the only behavioral adaptation. Portfolio
  totals (revenue/costs/net) are bucket-independent and unaffected; only the
  statement's per-bucket breakdown/pie depends on it. Buckets with no engine
  equivalent (supplies/maintenance/platformFees/insurance/taxes) route to `other`
  via name inference.
- Pre-codegen, `tsc`/`build` report `Property 'strCosts' does not exist on …api…`
  (+ `noImplicitAny` cascade). These are **expected** and clear after step 1; all
  non-api files typecheck clean today.
- CSV import does naive name-matching for external→internal property mapping; the
  user confirms each mapping in the UI before saving (same UX as the source).

## Rollback plan
- `git revert <merge sha>` — no data cleanup required (additive schema only;
  `portfolioViews` rows and any new `properties.status` values are inert if the
  feature is reverted).
