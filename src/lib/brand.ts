/**
 * Role-based branding — single source of truth for logo colors.
 *
 * Two independent surfaces consume this:
 *   1. In-app logo + accent  → colored by the LOGGED-IN role (per user, live).
 *   2. Installed PWA icon     → colored by a global admin setting
 *      (`appSettings.installedIconColor`), because the manifest is one shared
 *      static resource fetched before login. See the dynamic manifest route
 *      at `src/app/manifest.webmanifest/route.ts`.
 *
 * The colored icon assets live in `public/icons/app-icon-<key>-*.{png,svg}`
 * (generated to match the circular "Ops" mark; maskable/apple-touch are
 * full-bleed square so the platform applies its own mask).
 */

// J&A brand palette (from the official Brand Guide). Only the color changes —
// the logo mark stays our house-wave. Purple is kept for the Cleaner role, which
// matches the mobile cleaners app and is intentionally left as-is.
export const ICON_COLOR_KEYS = [
  "darkgreen",
  "sage",
  "taupe",
  "navy",
  "terracotta",
  "rust",
  "purple",
] as const;

export type IconColorKey = (typeof ICON_COLOR_KEYS)[number];

export const ICON_COLORS: Record<IconColorKey, { hex: string; label: string }> = {
  darkgreen: { hex: "#254c50", label: "Dark green" },
  sage: { hex: "#7da29c", label: "Sage" },
  taupe: { hex: "#9d8a79", label: "Taupe" },
  navy: { hex: "#0d1a32", label: "Navy" },
  terracotta: { hex: "#cb5a2b", label: "Terracotta" },
  rust: { hex: "#a53100", label: "Rust" },
  purple: { hex: "#9b51e0", label: "Purple" },
};

/** Fallback when no admin setting exists yet (the Ops role's brand color). */
export const DEFAULT_ICON_COLOR: IconColorKey = "sage";

export type BrandRole = "admin" | "property_ops" | "manager" | "owner" | "cleaner";

/** Which color each role wears in-app. */
export const ROLE_ICON_COLOR: Record<BrandRole, IconColorKey> = {
  admin: "darkgreen",
  property_ops: "sage",
  manager: "taupe",
  owner: "navy",
  cleaner: "purple",
};

export function isIconColorKey(value: unknown): value is IconColorKey {
  return (
    typeof value === "string" &&
    (ICON_COLOR_KEYS as readonly string[]).includes(value)
  );
}

export function iconColorHex(key: IconColorKey): string {
  return ICON_COLORS[key].hex;
}

/** Asset path prefix, e.g. "/icons/app-icon-sage" → append "-192.png" etc. */
export function iconAssetBase(key: IconColorKey): string {
  return `/icons/app-icon-${key}`;
}

/** In-app brand color for a role (falls back to the default for unknown roles). */
export function brandColorForRole(role: string | null | undefined): IconColorKey {
  if (role && role in ROLE_ICON_COLOR) {
    return ROLE_ICON_COLOR[role as BrandRole];
  }
  return DEFAULT_ICON_COLOR;
}

// ─────────────────────────────────────────────────────────────────────────────
// Installable apps — each has its own configurable installed-icon color.
// ─────────────────────────────────────────────────────────────────────────────

export const ICON_APPS = ["ops", "cleaner", "owner"] as const;
export type IconApp = (typeof ICON_APPS)[number];

export const APP_META: Record<
  IconApp,
  { label: string; description: string }
> = {
  ops: {
    label: "Ops",
    description: "Admin dashboard — scheduling, jobs, reports (app.chezsoistays.com).",
  },
  cleaner: {
    label: "Cleaner",
    description: "Field workspace for cleaners — /cleaner.",
  },
  owner: {
    label: "Owner",
    description: "Owner statements & transparency portal — /owner.",
  },
};

/** Default installed-icon color per app (used when unset). */
export const APP_ICON_DEFAULT: Record<IconApp, IconColorKey> = {
  ops: "sage",
  cleaner: "purple",
  owner: "navy",
};

export function isIconApp(value: unknown): value is IconApp {
  return (
    typeof value === "string" && (ICON_APPS as readonly string[]).includes(value)
  );
}

/** Which role's color each installable app's icon uses. */
export const APP_ROLE: Record<IconApp, BrandRole> = {
  ops: "property_ops",
  cleaner: "cleaner",
  owner: "owner",
};

// ─────────────────────────────────────────────────────────────────────────────
// Role color panel — an admin assigns a color to each role. Drives the in-app
// logo/favicon/accent (per logged-in role) and, via APP_ROLE, the 3 installable
// apps' icons. Cleaner is locked to purple.
// ─────────────────────────────────────────────────────────────────────────────

export const ALL_BRAND_ROLES = [
  "admin",
  "property_ops",
  "manager",
  "owner",
  "cleaner",
] as const;

/** Roles whose color an admin can change (cleaner is locked to purple). */
export const ADJUSTABLE_ROLES = [
  "admin",
  "property_ops",
  "manager",
  "owner",
] as const;
export type AdjustableRole = (typeof ADJUSTABLE_ROLES)[number];

export const ROLE_META: Record<
  BrandRole,
  { label: string; description: string; locked?: boolean }
> = {
  admin: { label: "Admin", description: "Full access to everything." },
  property_ops: {
    label: "Ops",
    description: "Property operations lead — scheduling, jobs, reports.",
  },
  manager: {
    label: "Manager",
    description: "Cleaner manager — their company's jobs & team.",
  },
  owner: {
    label: "Owner",
    description: "Property owner — statements & transparency portal.",
  },
  cleaner: {
    label: "Cleaner",
    description: "Field cleaner — always purple.",
    locked: true,
  },
};

/** Cleaner is always this color, regardless of settings. */
export const CLEANER_LOCKED_COLOR: IconColorKey = "purple";

export function isAdjustableRole(value: unknown): value is AdjustableRole {
  return (
    typeof value === "string" &&
    (ADJUSTABLE_ROLES as readonly string[]).includes(value)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Install links — Admin, Ops, and Manager share the same installable app (the
// Ops dashboard), so a shared URL can't give them distinct home-screen icons.
// These per-role install URLs (/install/<slug>) each carry that role's icon, so
// installing from the right link puts that role's icon on the phone.
// (Owner and Cleaner already install distinctly via /owner and /cleaner.)
// ─────────────────────────────────────────────────────────────────────────────

export const INSTALL_SLUGS = ["ops", "admin", "manager"] as const;
export type InstallSlug = (typeof INSTALL_SLUGS)[number];

export const INSTALL_SLUG_ROLE: Record<InstallSlug, BrandRole> = {
  ops: "property_ops",
  admin: "admin",
  manager: "manager",
};

/** Reverse map — the /install/<slug> for roles that share the Ops app. */
export const ROLE_INSTALL_SLUG: Partial<Record<BrandRole, InstallSlug>> = {
  property_ops: "ops",
  admin: "admin",
  manager: "manager",
};

export function isInstallSlug(value: unknown): value is InstallSlug {
  return (
    typeof value === "string" &&
    (INSTALL_SLUGS as readonly string[]).includes(value)
  );
}
