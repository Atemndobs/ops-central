---
name: Luminous Purple System
colors:
  surface: '#f8f9fa'
  surface-dim: '#d9dadb'
  surface-bright: '#f8f9fa'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f4f5'
  surface-container: '#edeeef'
  surface-container-high: '#e7e8e9'
  surface-container-highest: '#e1e3e4'
  on-surface: '#191c1d'
  on-surface-variant: '#4b4452'
  inverse-surface: '#2e3132'
  inverse-on-surface: '#f0f1f2'
  outline: '#7c7483'
  outline-variant: '#cdc3d4'
  surface-tint: '#7544b6'
  primary: '#7341b3'
  on-primary: '#ffffff'
  primary-container: '#8d5bce'
  on-primary-container: '#fffbff'
  inverse-primary: '#d8b9ff'
  secondary: '#635b6e'
  on-secondary: '#ffffff'
  secondary-container: '#e9def5'
  on-secondary-container: '#696174'
  tertiary: '#006b2d'
  on-tertiary: '#ffffff'
  tertiary-container: '#00873b'
  on-tertiary-container: '#f7fff3'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#eedcff'
  primary-fixed-dim: '#d8b9ff'
  on-primary-fixed: '#290054'
  on-primary-fixed-variant: '#5d289c'
  secondary-fixed: '#e9def5'
  secondary-fixed-dim: '#cdc2d9'
  on-secondary-fixed: '#1e1929'
  on-secondary-fixed-variant: '#4a4456'
  tertiary-fixed: '#6bff8f'
  tertiary-fixed-dim: '#4ae176'
  on-tertiary-fixed: '#002109'
  on-tertiary-fixed-variant: '#005321'
  background: '#f8f9fa'
  on-background: '#191c1d'
  surface-variant: '#e1e3e4'
typography:
  h1:
    fontFamily: Manrope
    fontSize: 20px
    fontWeight: '700'
    lineHeight: 28px
  h2:
    fontFamily: Manrope
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
  body-md:
    fontFamily: Manrope
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Manrope
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-caps:
    fontFamily: Manrope
    fontSize: 10px
    fontWeight: '800'
    lineHeight: 12px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  container-padding: 16px
  card-gap: 12px
  element-margin: 8px
---

## Brand & Style

This design system is built for clarity and approachability, specifically tailored for communication-heavy logistics or task management platforms. The personality is professional yet warm, using a soft purple palette to reduce the visual stress often associated with high-density information.

The design style follows a **Corporate / Modern** aesthetic with a strong emphasis on **Minimalism**. It utilizes ample whitespace and a refined layering system to distinguish between system-generated content and user messages. The overall emotional response should be one of organized calm, ensuring that users can quickly parse status updates and prioritize urgent actions without feeling overwhelmed.

## Colors

The palette is anchored by a vibrant Primary Purple used for high-importance summaries and primary call-to-actions. A Secondary Purple provides a soft tint for secondary containers, such as incoming messages, to distinguish them from the main background.

- **Primary (#9C6ADE):** Actionable items, buttons, and summary headers.
- **Secondary (#F3E8FF):** Soft background for message bubbles and secondary cards.
- **Background (#F9FAFB):** A neutral off-white to ground the interface.
- **Success (#22C55E):** Used for "Internal" or positive status indicators.
- **Text:** Deep charcoal (#1F2937) for headers and a softer slate (#4B5563) for body text.

## Typography

The system uses **Manrope** to achieve a balanced, modern look that remains highly legible at small sizes. 

- **Headlines:** Use Bold weights for primary navigation and card titles.
- **Body Text:** Standardized at 14px for optimal readability in message threads.
- **Labels:** Status badges and "Internal" tags use uppercase styling with increased letter spacing to create clear visual separation from narrative text.

## Layout & Spacing

The layout utilizes a **Fluid Grid** with fixed horizontal margins of 16px. Spacing follows a 4px base unit to ensure a tight, rhythmic alignment across message bubbles and input fields.

Vertical rhythm is maintained by a 12px gap between independent cards, while internal element spacing (like the gap between a profile icon and a message) is kept to 8px. Messaging interfaces should use a bottom-up stacking order with a fixed action bar at the base of the screen.

## Elevation & Depth

This design system uses **Tonal Layers** combined with **Ambient Shadows** to create a sense of hierarchy:

- **Level 0 (Base):** The #F9FAFB background.
- **Level 1 (Cards):** Pure white (#FFFFFF) cards with a very soft, diffused shadow (0px 2px 8px rgba(0,0,0,0.05)).
- **Level 2 (In-thread elements):** The Secondary Purple (#F3E8FF) is used to lift message bubbles slightly off the white cards without requiring shadows, relying on color contrast for depth.
- **Floating Actions:** The primary bottom buttons use a slightly heavier shadow to indicate they sit above the scrolling content.

## Shapes

The shape language is consistently **Rounded**. 

- **Standard Cards:** Use a 16px (`rounded-xl`) corner radius.
- **Message Bubbles:** Feature 12px (`rounded-lg`) corners, with the tail-side corner occasionally sharpened to indicate directionality.
- **Action Buttons:** Large primary buttons are fully pill-shaped (rounded-full) for maximum tap affordance.
- **Badges:** Small status tags use a 4px radius to maintain a distinct "label" look compared to message bubbles.

## Components

### Buttons
- **Primary:** Pill-shaped, #9C6ADE background, white text. Center-aligned.
- **Secondary:** Transparent background with purple border or #F3E8FF background.
- **Floating Action:** Circular buttons at the bottom right/left for quick tasks.

### Cards & Bubbles
- **Summary Card:** Features a Primary Purple header with white text, transitioning into a white body.
- **Message Bubbles:** Incoming messages use the Secondary Purple background; outgoing messages use white with a thin grey border.

### Status Badges
- **Labels:** Small, rectangular with slightly rounded corners. Use high-contrast background colors (e.g., #F3E8FF for "NEW JOB", light green for "INTERNAL") with bold, uppercase typography.

### Input Fields
- **Chat Input:** A white, pill-shaped container with a subtle inner shadow or light grey border. Placeholder text should be in the secondary text color.

### Lists
- **Activity Feed:** Use vertical lines (steppers) to connect status updates, with small circular icons representing different milestones.