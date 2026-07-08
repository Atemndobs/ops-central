# MobileShell

## Purpose
The fixed chrome that wraps every cleaner screen: top header (notifications, theme toggle, locale), main scrollable area, bottom nav. Same layout on web PWA and mobile app.

## Structure

```
┌─────────────────────────────────┐  ← safe-area top
│          Header (72px)          │
├─────────────────────────────────┤
│                                 │
│         Scrollable main         │
│        (pb-24 to clear nav)     │
│                                 │
├─────────────────────────────────┤
│        Bottom Nav (64px)        │
└─────────────────────────────────┘  ← safe-area bottom
```

## Dimensions
- **Max content width**: `402px` (see `layout.cleanerShellMaxWidth`). Tablet-capped; on desktop the shell centers.
- **Header height**: `72px` + `env(safe-area-inset-top)`
- **Header max-width**: `402px`, padding `12px` horizontal + `12px` vertical
- **Main**: fills between header and nav; scrolls internally (not the window)
- **Nav**: `64px` minimum + `max(env(safe-area-inset-bottom), 6px)`

## Viewport (web PWA only)
- `<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">`
- `height: 100svh` (small viewport height) on the outer wrapper to avoid address-bar reflow on mobile Safari
- Disable pinch zoom (PWA feels native)

## Header contents
- Left: logo / locale switcher
- Center: active screen title (optional)
- Right: theme toggle, notifications `IconButton` (with unread badge)
- Background: `white / 92% opacity` + backdrop blur (light); equivalent dark-mode surface
- Border: `1px bottom` (only on scrolled / non-transparent variant)

## Header variants
- `default` — bordered, backdrop-blurred surface
- `transparent` — no border, transparent bg (used on property detail screens to show hero image underneath)

## iOS input-zoom guard
Any `<input>`, `<select>`, `<textarea>` under `@media (pointer: coarse)` must have `font-size ≥ 16px` — otherwise iOS zooms on focus. On web this is enforced in `globals.css`; mobile should enforce in the `TextInput` primitive.

## A11y
- Header = `<header>` landmark
- Main = `<main>` landmark with `id="main"` for skip links
- Nav = `<nav>` landmark, `aria-label="Primary"`

## Reference
- Web: [src/components/cleaner/cleaner-shell.tsx](../../../src/components/cleaner/cleaner-shell.tsx) + [src/app/cleaner/layout.tsx](../../../src/app/cleaner/layout.tsx)
- Mobile: currently uses Expo Router tab layout in `app/(cleaner)/_layout.tsx` — will align to these dimensions in Phase 3
