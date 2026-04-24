/**
 * Motion tokens — durations and easings for transitions/animations.
 * Small surface area on purpose; extend only when a real use case appears.
 */

export const durations = {
  instant: 0,
  fast: 120,
  normal: 200,
  slow: 320,
} as const;

export const easings = {
  standard: "cubic-bezier(0.2, 0, 0, 1)",
  decelerate: "cubic-bezier(0, 0, 0.2, 1)",
  accelerate: "cubic-bezier(0.4, 0, 1, 1)",
} as const;

/**
 * Press-feedback scale for tappable elements (e.g. `.cleaner-tool-button active:scale-95`).
 */
export const pressScale = 0.95;
