# Role-based branding (admin web app)

**Date:** 2026-07-11 · **Status:** implemented (PR pending)

Cleaner mobile app stays purple. The admin web app gets role/color branding on
two independent surfaces.

## A. In-app logo + accent — colored by the LOGGED-IN role (per user, live)
- `role` is already resolved client-side in the sidebar.
- Sidebar logo mark swaps to the role's colored icon.
- A `--brand` CSS var is set on `:root` and the **browser-tab favicon** is swapped
  to the role color (client-side effect in `sidebar.tsx`).
- Role → color: admin `indigo`, property_ops `teal`, manager `amber`,
  owner `blue`, cleaner `purple`.
- Deliberately does **not** override `--primary` (avoids button contrast
  regressions, esp. amber on dark). `--brand` is available for future accents.

## B. Installed PWA icon — global admin choice (one for the whole team)
Why global, not per-role: the manifest is a single shared resource fetched
**before login**, so it can't know who's installing.

- `appSettings.installedIconColor` (Convex, optional; absent ⇒ `teal`).
- Public query `getInstalledIconColor` + admin mutation `setInstalledIconColor`.
- **Dynamic manifest** at `src/app/manifest.webmanifest/route.ts` reads the
  setting and points at the matching icon set (`background_color`/`theme_color`
  + icons). `layout.tsx` → `manifest: "/manifest.webmanifest"`. Old static
  `public/manifest.json` removed.
- Settings → Integrations → **"App icon color"** card (`AppIconColorCard`) with
  5 swatches; admin-only (mutation uses `requireAdmin`).
- **Takes effect for NEW installs.** Existing home-screen icons keep their color
  until the app is removed + re-added (manifests are cached aggressively).

## Assets
`public/icons/app-icon-<key>-{192,512,maskable-512,apple-touch}.png` + `<key>.svg`
for keys indigo/teal/amber/blue/purple. Circular "any" icons; maskable +
apple-touch are full-bleed square (platform applies its own mask). Single source
of truth for keys/hex/role-map: `src/lib/brand.ts`.

## Deploy notes
- Additive schema field → safe for the cleaners app; deploy Convex from the main
  session, then `npm run sync:convex-backend` in the cleaners repo.
- Vercel auto-deploys the frontend on merge to `main`.
