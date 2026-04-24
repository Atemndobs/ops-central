# BottomNav

## Purpose
Fixed 4-column primary navigation at the bottom of every cleaner screen.

## Structure
- 4 equal columns, `grid-cols-4`
- Each column is a tappable cell: icon + label stacked, centered
- The active cell uses the `active` IconButton appearance

## Tabs

| Position | Key | Icon | Route |
|---|---|---|---|
| 1 | `jobs` | `ClipboardList` | `/cleaner` |
| 2 | `messages` | `MessageCircle` | `/cleaner/messages` |
| 3 | `incidents` | `AlertTriangle` | `/cleaner/incidents` |
| 4 | `profile` | `User` | `/cleaner/more` |

Labels come from i18n: `common.jobs`, `common.messages`, `cleaner.nav.incidents`, `common.settings`.

## Visual
- Background: `white / 96% opacity` + backdrop blur (light mode); dark surface analog
- Border-top: `1px var(--border)`
- Shadow: `shadow.small` (subtle lift above content)
- Padding: `8px` top, `max(env(safe-area-inset-bottom), 6px)` bottom
- Cell padding: `4px` vertical
- Icon size: `24×24`
- Label: `10px`, medium weight
- Active cell: icon + label tinted with `color.cleaner.primary`; inactive cells use `color.cleaner.muted`
- Unread badge (on messages/incidents): red circle top-right of icon, same spec as [IconButton](../IconButton.md) badge

## Touch targets
- Minimum cell width: `60px`
- Minimum cell height: `56px` (icon + label + padding)
- Each cell's entire area is tappable, not just the icon

## States
- Active: route matches or is nested under tab's route
- Pressed: `active:scale-95` on the cell (or subtler `bg tint`)
- Focus-visible: ring around the icon

## A11y
- `<nav aria-label="Primary">`
- Each tab is a `<Link>`/`<a>`, not a `<button>`
- Active tab: `aria-current="page"`
- Label is always visible — don't rely on tooltips

## Reference
- Web: nav block in [src/components/cleaner/cleaner-shell.tsx](../../../src/components/cleaner/cleaner-shell.tsx)
- Mobile: Expo Router `Tabs` with 4 visible tabs + hidden screens in `app/(cleaner)/_layout.tsx`
