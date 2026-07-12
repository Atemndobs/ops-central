# Role color panel (replaces per-app icon panel)

**Date:** 2026-07-12 · Supersedes the per-app panel in [2026-07-12-per-app-icons](2026-07-12-per-app-icons.md)

The settings panel is now organized by **role**, not by app. An admin assigns a
color to each role; Cleaner is locked to purple.

## Model
Per-role colors in `appSettings` (all optional; absent ⇒ role default):
`roleColorAdmin` (indigo), `roleColorPropertyOps` (teal), `roleColorManager`
(amber), `roleColorOwner` (blue). Cleaner is always purple (not stored).
Back-compat: ops/owner fall back to the old `installedIconColor` /
`installedIconColorOwner` so earlier picks aren't lost.

Convex (`convex/appSettings.ts`):
- `getRoleIconColors()` → all 5 role colors (in-app sidebar reads this).
- `listRoleIconColors()` → rows for the panel (cleaner `locked: true`).
- `setRoleIconColor({ role, color })` — admin; role ∈ admin|property_ops|manager|owner.
- `getInstalledIconColor({ app })` — kept for the manifest/icon routes, now
  derived from the app's role via `APP_ROLE` (ops→property_ops, owner→owner,
  cleaner→cleaner/purple).

## What each color drives
- **In-app** logo + tab favicon + `--brand` accent: the logged-in role's color
  (all 5 roles) — `src/components/layout/sidebar.tsx` reads `getRoleIconColors`.
- **Installed app icons** (3 apps, unchanged routes): Ops app = Ops color,
  Owner app = Owner color, Cleaner app = purple. Admin & Manager have no separate
  installable app, so their color shows in-app only.

## UI
Settings → Integrations → **"Role colors"**: 5 rows (Admin, Ops, Manager, Owner
adjustable; Cleaner grayed + lock icon). `app-icon-color-card.tsx`.

## Source of truth
`src/lib/brand.ts` — `ROLE_ICON_COLOR` (defaults), `ROLE_META`, `ADJUSTABLE_ROLES`,
`APP_ROLE`, `isAdjustableRole`.

Additive schema fields → safe for the cleaners app.
