# Button

## Purpose
Standard action control. Four variants covering the majority of cleaner-surface actions.

## Variants

| Variant | Use | Background | Foreground | Border |
|---|---|---|---|---|
| `primary` | Main CTA (Start, Submit, Confirm) | `color.cleaner.primary` | white | — |
| `outline` | Secondary action (Cancel, Later) | transparent | `color.cleaner.primary` | 1px `color.cleaner.primary` |
| `ghost` | Tertiary (Back, Skip) | transparent | `color.cleaner.ink` | — |
| `danger` | Destructive (Remove, Reject) | `color.destructive` | white | — |

## Sizes

| Size | Padding | Font size | Use |
|---|---|---|---|
| `sm` | `8px 12px` | 12px | Chip-adjacent / card footer |
| `md` (default) | `10px 12px` | 13px | Standard CTA |
| `lg` | `12px 16px` | 15px | Full-width primary on detail screens |

## Visual
- Radius: `10px` (not pill, not card)
- Font: cleaner body, `600` weight for primary/danger, `500` for outline/ghost
- No default shadow — add shadow only when the button floats (e.g. sticky bottom sheet)

## States
- Hover (web): `opacity 90%` for solid bg, `bg color.cleaner.primary / 10%` for outline/ghost
- Pressed: `active:scale-95` (matches IconButton press feedback)
- Focus-visible: ring `color.cleaner.primary`, 2px offset
- Disabled: `opacity 50%`, pointer-events none, no hover

## A11y
- Always include button text OR an `aria-label` when the button is icon-only
- Disabled buttons must not receive focus

## Reference
- Web (current): utility classes `.cleaner-primary-button` and `.cleaner-outline-button` in [src/app/globals.css](../../src/app/globals.css) (~lines 197–203); no shadcn `<Button>` equivalent is used on cleaner pages
- Mobile: to be created at `components/cleaner/Button.tsx` (Phase 3) — replaces current `ThemedButton` variants on cleaner screens
