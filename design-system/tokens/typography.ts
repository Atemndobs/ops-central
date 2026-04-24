/**
 * Typography tokens — fonts, sizes, weights, line heights.
 *
 * The cleaner surface uses three Google Fonts: Spectral (display), Montserrat (body),
 * Atkinson Hyperlegible (meta/mono). Admin surfaces use Geist Sans.
 */

export const fontFamilies = {
  cleanerDisplay: ["var(--font-cleaner-display)", "Spectral", "serif"],
  cleanerBody: ["var(--font-cleaner-body)", "Montserrat", "system-ui", "sans-serif"],
  cleanerMeta: ["var(--font-cleaner-mono)", "Atkinson Hyperlegible", "monospace"],
  adminSans: ["var(--font-geist-sans)", "system-ui", "-apple-system", "sans-serif"],
  adminMono: ["var(--font-geist-mono)", "monospace"],
} as const;

/**
 * Google Fonts source of truth — what to load on each platform.
 * Web loads via Next.js `next/font/google`. Mobile loads via `expo-font`.
 */
export const fontSources = {
  spectral: { family: "Spectral", weights: [700] },
  montserrat: { family: "Montserrat", weights: [500, 600, 700] },
  atkinsonHyperlegible: { family: "Atkinson Hyperlegible", weights: [400, 700] },
} as const;

export const fontWeights = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const;

/**
 * Type scale (px). Kept small — the cleaner PWA is mobile-first and uses
 * Tailwind arbitrary values heavily.
 */
export const fontSizes = {
  xxs: 10, // eyebrow / micro
  xs: 12,
  sm: 13,
  base: 14,
  md: 16, // minimum input size (prevents iOS zoom)
  lg: 18,
  xl: 22,
  "2xl": 26, // cleaner-card-title (1.6rem)
  "3xl": 32,
  display: 40,
} as const;

export const lineHeights = {
  tight: 1,
  snug: 1.15,
  normal: 1.35,
  relaxed: 1.55,
} as const;

export const letterSpacing = {
  display: "-0.03em", // cleaner-display, cleaner-card-title
  normal: "0",
  eyebrow: "0.18em", // cleaner-eyebrow, cleaner-meta (uppercase)
} as const;

/**
 * Semantic type styles — use these rather than composing primitives inline.
 * Web translates via Tailwind utility classes; mobile via StyleSheet.
 */
export const textStyles = {
  display: {
    family: fontFamilies.cleanerDisplay,
    weight: fontWeights.bold,
    letterSpacing: letterSpacing.display,
    lineHeight: lineHeights.tight,
  },
  cardTitle: {
    family: fontFamilies.cleanerDisplay,
    weight: fontWeights.bold,
    size: fontSizes["2xl"],
    letterSpacing: letterSpacing.display,
    lineHeight: lineHeights.tight,
  },
  eyebrow: {
    family: fontFamilies.cleanerMeta,
    weight: fontWeights.regular,
    size: fontSizes.xxs,
    letterSpacing: letterSpacing.eyebrow,
    textTransform: "uppercase" as const,
  },
  body: {
    family: fontFamilies.cleanerBody,
    weight: fontWeights.medium,
    size: fontSizes.base,
    lineHeight: lineHeights.normal,
  },
  bodyStrong: {
    family: fontFamilies.cleanerBody,
    weight: fontWeights.semibold,
    size: fontSizes.base,
    lineHeight: lineHeights.normal,
  },
  button: {
    family: fontFamilies.cleanerBody,
    weight: fontWeights.semibold,
    size: fontSizes.sm,
    lineHeight: lineHeights.tight,
  },
} as const;
