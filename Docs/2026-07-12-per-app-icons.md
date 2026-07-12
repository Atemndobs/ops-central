# Per-app installed icons

**Date:** 2026-07-12 · Extends [2026-07-11-role-based-branding](2026-07-11-role-based-branding.md)

Problem: the single "App icon color" picker only controlled the Ops app, and it
read as "5 apps" when it was really 5 color options for one app. Cleaner and Owner
also installed with the *same* purple icon (indistinguishable).

Fix: every installable PWA (Ops, Cleaner, Owner) gets its own configurable,
color-aware installed icon, and Settings lists them explicitly.

## Data
`appSettings` per-app color fields (all optional; absent ⇒ per-app default):
- `installedIconColor` → **Ops** (default teal)
- `installedIconColorCleaner` → **Cleaner** (default purple, brand)
- `installedIconColorOwner` → **Owner** (default blue)

Convex (`convex/appSettings.ts`): `getInstalledIconColor({ app? })` (app defaults
to "ops" for back-compat), `setInstalledIconColor({ app, color })` (admin),
`listAppIconColors()` (all three, for the panel).

## Routes (all force-dynamic, read the setting, fall back to default)
- `/manifest.webmanifest` (Ops), `/cleaner-manifest.webmanifest`,
  `/owner-manifest.webmanifest` — dynamic manifests; icons point at the app's
  color set. Cleaner/Owner keep their light theme + scope + shortcuts; static
  `public/*-manifest.webmanifest` deleted.
- `/brand-icon/[app]/[asset]` — favicon/apple-touch redirect to the app's color
  asset. Replaces the old single-app `/brand-icon/[asset]`.
- Each layout's `<head>` icon/apple links point at `/brand-icon/<app>/…`.

## Settings
Settings → Integrations → **"App icon colors"** now shows one row per app
(icon preview + label + 5 swatches). `src/components/settings/app-icon-color-card.tsx`.

## Source of truth
`src/lib/brand.ts` — `ICON_APPS`, `APP_META`, `APP_ICON_DEFAULT`, `isIconApp`.

## Caveats (unchanged)
New installs only; existing home-screen icons update on reinstall (iOS caches
apple-touch hard). Additive schema fields → safe for the cleaners app.
