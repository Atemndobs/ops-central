# Worktree Handoff

## Task
TASK-MONTHLY-CLOSE-THEME-001

## Type
bugfix

## Branch
fix/monthly-close-theme

## Worktree
~/sites/opscentral-admin-mc-theme

## Base
origin/main @ bfd57a0

## Status
ready-for-integration

## What changed
Fixes transparent surfaces on `/reports/monthly-close` (reported: the Hospitable
import modal showed the table through it). The module (from #179) used
shadcn-style **named** color utilities (`bg-background`, `bg-muted`, `bg-primary`,
`text-muted-foreground`, `border-border`, …). OpsCentral's Tailwind v4 has **no
`@theme` block** registering those as color utilities, so they generate **no
CSS** — silent no-ops (modal panel had no fill; primary buttons / muted text /
hovers were unstyled too).

Converted every named color utility in `src/admin/tools/monthly-close/*` to the
arbitrary `bg-[var(--token)]` / `text-[var(--token)]` syntax the rest of the app
uses (every cleaner component + the `ui/` primitives already do this). Opacity
variants collapse to solid var colors. Modal panel → `--popover`, inputs →
`--card`; checkbox `accent` + button hover restored. 5 files, ~55 lines.

## What main should test
1. `npm run lint` — 0 errors (1 pre-existing verbatim warning in `buildStatementHtml.ts`).
2. `npm run build`.
3. Manual: `/reports/monthly-close` → "Import Hospitable CSV" → modal panel is now
   an **opaque** surface (no table bleed-through); "Export CSV" primary button is
   filled; muted helper text + row hovers render.

## Schema impact
none

## Convex impact
none (CSS/className changes only)

## Commands main should run
- npm run lint
- npm run build

## Known risks
- Very low — className-string changes only; no logic, no schema, no Convex.
- Opacity nuance: former `/40`–`/10` tints now render as solid `var(--muted)`
  (slightly stronger zebra/hover). Intentional — opacity on arbitrary var colors
  is unreliable in this setup.

## Related (NOT in this PR — follow-up candidate)
`src/components/admin/owner-overview/{StatementEditor,PropertySplitView}.tsx` use
the same named utilities and likely share the latent transparency bug.

## Rollback plan
- `git revert <merge sha>` — no data/schema impact.
