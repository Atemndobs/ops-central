/**
 * Design system tokens — barrel export.
 *
 * Web imports from here via `@/design-system/tokens` (tsconfig alias) or a
 * direct relative path. Mobile (jna-cleaners-app) imports from
 * `../../opscentral-admin/design-system/tokens` once Phase 3 lands — until
 * then this file is consumed by the web app only.
 */

export {
  cleanerColors,
  statusPillColors,
  countdownTierColors,
  adminColors,
} from "./colors";
export type { CleanerMode, StatusAppearance, CountdownTier } from "./colors";

export {
  fontFamilies,
  fontSources,
  fontWeights,
  fontSizes,
  lineHeights,
  letterSpacing,
  textStyles,
} from "./typography";

export { spacing, radii, shadows, layout } from "./spacing";

export { durations, easings, pressScale } from "./motion";
