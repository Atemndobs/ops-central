/**
 * Spacing, radii, and shadow tokens.
 *
 * Scale aligns with Tailwind's default where possible. Cleaner-specific radii
 * and the `--cleaner-shadow` are kept as named tokens because they encode
 * intent (card, pill, button) that should not drift.
 */

export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
  20: 80,
  24: 96,
} as const;

export const radii = {
  none: 0,
  sm: 4,
  md: 8,
  button: 10, // cleaner-outline-button, cleaner-primary-button
  lg: 12,
  section: 16, // badge variant
  card: 24, // cleaner-card — THE canonical card radius
  pill: 9999,
} as const;

/**
 * Shadow presets. `cleanerCard` is the signature soft drop used under the
 * purple cards; adjust opacity between modes.
 */
export const shadows = {
  cleanerCard: {
    light: "0 12px 30px -8px rgba(0, 0, 0, 0.1)",
    dark: "0 16px 40px -12px rgba(0, 0, 0, 0.45)",
  },
  messagesFloat: {
    light: "0 10px 28px -12px rgba(115, 65, 179, 0.45)",
    dark: "0 10px 28px -12px rgba(184, 147, 255, 0.35)",
  },
  small: {
    light: "0 2px 8px rgba(0, 0, 0, 0.05)",
    dark: "0 2px 10px rgba(0, 0, 0, 0.5)",
  },
} as const;

/**
 * Layout constraints specific to the cleaner mobile PWA shell.
 * Mobile app should honor the same max-width so the two surfaces render
 * identically at the same viewport width.
 */
export const layout = {
  /** Max content width of the cleaner PWA shell — tablet-friendly cap. */
  cleanerShellMaxWidth: 402,
  /** Header height (excluding safe-area inset) */
  cleanerHeaderHeight: 72,
  /** Bottom nav minimum touch target row */
  cleanerNavMinHeight: 64,
  sidebarWidth: 256,
  sidebarWidthCollapsed: 64,
} as const;
