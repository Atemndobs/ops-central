# IconButton

## Purpose
Circular pressable control used for toolbar and bottom-nav affordances. Can show an active state and an optional unread badge.

## Inputs
- `icon` — icon component (Lucide on web; `@expo/vector-icons` or SVG on mobile)
- `label` — a11y/tooltip text (required — never purely visual)
- `active` — boolean, default `false`
- `badge` — optional number; hidden when 0/undefined
- `size` — `tool` | `nav`
- `onClick` / `onPress` — handler

## Sizes

| Size | Container | Icon |
|---|---|---|
| `tool` | 32×32 | 18×18 (approx — `h-4.5 w-4.5`) |
| `nav` | 48×48 | 24×24 |

## Appearances

| State | `tool` bg/fg | `nav` bg/fg |
|---|---|---|
| default | `white` / `cleaner.ink` | `cleaner.muted` / white |
| active  | `cleaner.primary` / white | `cleaner.primary` / white |

All variants use the `cleaner-tool-button` surface: `rounded-full`, `shadow.cleanerCard`, press scale `0.95`.

## Badge
- Positioned at top-right, `-4px` offset (`-right-1 -top-1`)
- Circle, `min 16×16`, `px-1`, `bg destructive`, `text white`, `9px` bold
- Shows `9+` when value > 9

## States
- `active:scale-95` press feedback
- Hover: none (touch-first)
- Focus-visible: ring `color.cleaner.primary` (outside the circle)

## A11y
- `aria-label` (web) / `accessibilityLabel` (mobile) = `label`
- `role="button"` implicit via `<button>` on web; `Pressable accessibilityRole="button"` on mobile
- Badge count should also be announced — either in the label (`"Notifications, 3 unread"`) or as separate live text

## Reference
- Web: `CleanerIconButton` in [src/components/cleaner/cleaner-ui.tsx](../../src/components/cleaner/cleaner-ui.tsx) (~line 369)
- Mobile: to be created at `components/cleaner/IconButton.tsx` (Phase 3)
