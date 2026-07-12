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

export const ICON_COLOR_KEYS = [
  "indigo",
  "teal",
  "amber",
  "blue",
  "purple",
] as const;

export type IconColorKey = (typeof ICON_COLOR_KEYS)[number];

export const ICON_COLORS: Record<IconColorKey, { hex: string; label: string }> = {
  indigo: { hex: "#4f46e5", label: "Indigo" },
  teal: { hex: "#0d9488", label: "Teal" },
  amber: { hex: "#f59e0b", label: "Amber" },
  blue: { hex: "#2563eb", label: "Blue" },
  purple: { hex: "#9b51e0", label: "Purple" },
};

/** Fallback when no admin setting exists yet (matches the shipped "Ops" teal). */
export const DEFAULT_ICON_COLOR: IconColorKey = "teal";

export type BrandRole = "admin" | "property_ops" | "manager" | "owner" | "cleaner";

/** Which color each role wears in-app. */
export const ROLE_ICON_COLOR: Record<BrandRole, IconColorKey> = {
  admin: "indigo",
  property_ops: "teal",
  manager: "amber",
  owner: "blue",
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

/** Asset path prefix, e.g. "/icons/app-icon-teal" → append "-192.png" etc. */
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
  ops: "teal",
  cleaner: "purple",
  owner: "blue",
};

export function isIconApp(value: unknown): value is IconApp {
  return (
    typeof value === "string" && (ICON_APPS as readonly string[]).includes(value)
  );
}
