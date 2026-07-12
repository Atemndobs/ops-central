# Adopt J&A brand palette for role colors

**Date:** 2026-07-12 · Designer: Jule.

Only the COLOR changes — the logo mark stays our house-wave (not the J&A
lettermark). Palette from the official Brand Guide:

| Key | Hex | Role default |
|---|---|---|
| darkgreen | #254c50 | Admin |
| sage | #7da29c | Ops (property_ops) |
| taupe | #9d8a79 | Manager |
| navy | #0d1a32 | Owner |
| terracotta | #cb5a2b | (option) |
| rust | #a53100 | (option) |
| purple | #9b51e0 | Cleaner — unchanged, matches mobile app |

- Replaces the old placeholder palette (indigo/teal/amber/blue). Source of truth
  `src/lib/brand.ts`; schema enum `brandIconColorV` in `convex/schema.ts`;
  `ROLE_COLOR_DEFAULT` in `convex/appSettings.ts`.
- Cleaner untouched (locked purple).
- Migration: stored old-key color values were cleared first (temp
  `_clearIconColorSettings` run under the old schema) so the new enum deploys
  clean; roles then fall back to the new brand defaults.
- Assets regenerated: `public/icons/app-icon-<brandkey>-*`; old-key assets removed.
- Everything downstream (in-app logo/favicon, 3 app icons, /install/* links)
  inherits automatically.
