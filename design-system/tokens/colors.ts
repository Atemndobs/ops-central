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

/**
 * Feedback colors — pass / skip / fail / info semantic states used inside
 * job-execution flows (checkpoint badges, room rows, incident callouts,
 * progress dots). All tiers derive from the canonical cleaner palette so
 * the brand stays cohesive — no separate green/amber:
 *
 *  - success / info → primary (purple) at low alpha for bg, primary for fg
 *  - warning        → ink/muted at low alpha (a "skipped"-looking neutral)
 *  - danger         → the same destructive red used by the StatusPill `rework`
 *                     and the web `--destructive` button variant
 */
export const feedbackColors = {
  light: {
    success: { bg: "rgba(155,81,224,0.1)", border: "rgba(155,81,224,0.35)", fg: cleanerColors.light.primary },
    warning: { bg: "rgba(51,51,51,0.06)", border: "rgba(51,51,51,0.18)", fg: cleanerColors.light.muted },
    danger: { bg: "rgba(225,29,72,0.08)", border: "rgba(225,29,72,0.35)", fg: "#e11d48" },
    info: { bg: "rgba(155,81,224,0.1)", border: "rgba(155,81,224,0.35)", fg: cleanerColors.light.primary },
  },
  dark: {
    success: { bg: "rgba(189,119,255,0.18)", border: "rgba(189,119,255,0.45)", fg: cleanerColors.dark.primary },
    warning: { bg: "rgba(247,243,255,0.08)", border: "rgba(247,243,255,0.18)", fg: cleanerColors.dark.muted },
    danger: { bg: "rgba(244,63,94,0.18)", border: "rgba(244,63,94,0.45)", fg: "#f43f5e" },
    info: { bg: "rgba(189,119,255,0.18)", border: "rgba(189,119,255,0.45)", fg: cleanerColors.dark.primary },
  },
} as const;

/**
 * Subtle border + overlay colors derived from each mode's ink, used for
 * dividers, hairlines, and translucent fills inside cleaner surfaces.
 */
export const cleanerBorders = {
  light: {
    subtle: "rgba(0,0,0,0.06)",
    strong: "rgba(0,0,0,0.12)",
    overlayWeak: "rgba(0,0,0,0.04)",
    overlayStrong: "rgba(0,0,0,0.08)",
  },
  dark: {
    subtle: "rgba(255,255,255,0.08)",
    strong: "rgba(255,255,255,0.18)",
    overlayWeak: "rgba(255,255,255,0.05)",
    overlayStrong: "rgba(255,255,255,0.1)",
  },
} as const;

export type CleanerMode = keyof typeof cleanerColors;
export type StatusAppearance = keyof typeof statusPillColors.light;
export type CountdownTier = keyof typeof countdownTierColors.light;
export type FeedbackTier = keyof typeof feedbackColors.light;
