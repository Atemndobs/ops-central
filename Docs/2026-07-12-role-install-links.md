# Per-role install links

**Date:** 2026-07-12 · Extends the role-color panel.

Admin, Ops, and Manager share the Ops dashboard (one URL/manifest), so a shared
install can't give them distinct home-screen icons — and iOS fetches the icon
without login context, so it can't auto-detect the role. Fix: a dedicated
install URL per role that carries that role's icon.

- `/install/<slug>` (slug ∈ ops|admin|manager): public page with the role's
  `apple-touch-icon` + a role-specific manifest in its head. Installing from it
  gives that role's icon; `start_url` is `/` so it opens the normal dashboard.
  Redirects to `/` when launched standalone (StandaloneRedirect).
- `/install/<slug>/manifest.webmanifest`: distinct `id`, role-colored icons,
  reads the configured role color via `getRoleIconColors`.
- Public via `proxy.ts` (`/install(.*)`); manifest is public via the matcher's
  `.webmanifest` exclusion.
- Settings "Role colors" shows each role's **install link + Copy** button
  (property_ops→/install/ops, admin→/install/admin, manager→/install/manager;
  owner→/owner, cleaner→/cleaner).

Send each person their role's link; they install once. Owner/Cleaner already
install distinctly via their own scopes. New installs only (iOS caches hard).
`src/lib/brand.ts`: INSTALL_SLUGS, INSTALL_SLUG_ROLE, ROLE_INSTALL_SLUG.
