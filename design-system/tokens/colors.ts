/**
 * Color tokens — source of truth for both web (opscentral-admin) and mobile (jna-cleaners-app).
 *
 * Two token families:
 *  - `cleaner` — the cleaner-facing PWA + mobile app palette (purple primary, light/dark).
 *  - `admin`   — the internal ops dashboard palette (shadcn-style oklch values).
 *
 * The cleaner palette is the pilot for cross-platform parity. Admin stays web-only for now.
 */

export const cleanerColors = {
  light: {
    bg: "#f2f2f2",
    surface: "#ffffff",
    ink: "#333333",
    muted: "#828282",
    primary: "#9b51e0",
    primarySoft: "#bd77ff",
    onPrimary: "#ffffff",
    shadow: "0 12px 30px -8px rgba(0, 0, 0, 0.1)",
  },
  dark: {
    bg: "#181426",
    surface: "#241f37",
    ink: "#f7f3ff",
    muted: "#c3b5df",
    primary: "#bd77ff",
    primarySoft: "#9b51e0",
    onPrimary: "#ffffff",
    shadow: "0 16px 40px -12px rgba(0, 0, 0, 0.45)",
  },
} as const;

/**
 * Status pill appearances — the 4 canonical cleaner-job states.
 * Maps directly to `CleanerStatusPill` appearance prop.
 *
 *  - open       covers: scheduled, assigned, rework_required (pre-review)
 *  - in_review  covers: awaiting_approval
 *  - completed  terminal success
 *  - rework     destructive, returned for fixes
 */
export const statusPillColors = {
  light: {
    open: { bg: cleanerColors.light.primary, fg: "#ffffff" },
    inReview: { bg: cleanerColors.light.ink, fg: cleanerColors.light.surface },
    completed: { bg: "#111111", fg: "#ffffff" },
    rework: { bg: "#e11d48", fg: "#ffffff" },
  },
  dark: {
    open: { bg: cleanerColors.dark.primary, fg: "#ffffff" },
    inReview: { bg: cleanerColors.dark.ink, fg: cleanerColors.dark.surface },
    completed: { bg: "#111111", fg: "#ffffff" },
    rework: { bg: "#f43f5e", fg: "#ffffff" },
  },
} as const;

/**
 * Countdown tier colors — urgency on job timers.
 *  - calm   > 1 day out
 *  - soon   1–24h
 *  - urgent ≤ 1h
 */
export const countdownTierColors = {
  light: {
    calm: { bg: cleanerColors.light.surface, fg: cleanerColors.light.ink },
    soon: { bg: cleanerColors.light.primary, fg: "#ffffff" },
    urgent: { bg: "#e11d48", fg: "#ffffff" },
  },
  dark: {
    calm: { bg: cleanerColors.dark.surface, fg: cleanerColors.dark.ink },
    soon: { bg: cleanerColors.dark.primary, fg: "#ffffff" },
    urgent: { bg: "#f43f5e", fg: "#ffffff" },
  },
} as const;

/**
 * Admin dashboard palette — current shadcn/ui theme for the ops dashboard.
 * Values in oklch (web-only). Not intended for mobile consumption.
 */
export const adminColors = {
  light: {
    background: "oklch(0.98 0.01 262)",
    foreground: "oklch(0.24 0.02 255)",
    card: "oklch(1 0 0)",
    cardForeground: "oklch(0.24 0.02 255)",
    primary: "oklch(0.59 0.22 308)",
    primaryForeground: "oklch(0.99 0 0)",
    secondary: "oklch(0.94 0.02 258)",
    muted: "oklch(0.95 0.01 258)",
    mutedForeground: "oklch(0.52 0.03 255)",
    accent: "oklch(0.95 0.02 258)",
    destructive: "oklch(0.62 0.22 27)",
    success: "oklch(0.66 0.18 150)",
    warning: "oklch(0.83 0.16 80)",
    border: "oklch(0.89 0.01 255)",
    ring: "oklch(0.59 0.22 308)",
  },
  dark: {
    background: "oklch(0.145 0 0)",
    foreground: "oklch(0.985 0 0)",
    card: "oklch(0.178 0 0)",
    cardForeground: "oklch(0.985 0 0)",
    primary: "oklch(0.68 0.19 307)",
    primaryForeground: "oklch(0.985 0 0)",
    secondary: "oklch(0.269 0 0)",
    muted: "oklch(0.269 0 0)",
    mutedForeground: "oklch(0.708 0 0)",
    accent: "oklch(0.269 0 0)",
    destructive: "oklch(0.577 0.245 27.33)",
    success: "oklch(0.627 0.194 163)",
    warning: "oklch(0.769 0.188 70.08)",
    border: "oklch(0.269 0 0)",
    ring: "oklch(0.68 0.19 307)",
  },
} as const;

export type CleanerMode = keyof typeof cleanerColors;
export type StatusAppearance = keyof typeof statusPillColors.light;
export type CountdownTier = keyof typeof countdownTierColors.light;
