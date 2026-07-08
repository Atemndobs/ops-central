# Badge

## Purpose
Generic chip/pill for attribute display. Distinct from [StatusPill](StatusPill.md) (which is 4-state, job-specific). Used for room counts, guest counts, flags, and other inline metadata.

## Variants

| Variant | Background | Foreground | Use |
|---|---|---|---|
| `neutral` (default) | `color.muted` | `color.cleaner.ink` | Rooms, beds, baths, guests |
| `outline` | transparent | `color.cleaner.muted` | Inline flags when space is tight |
| `primary-soft` | `color.cleaner.primary / 10%` | `color.cleaner.primary` | Active filters, counts |
| `warning-soft` | amber / 10% | amber-700 | Timing risks (late checkout, early check-in) |
| `destructive-soft` | red / 10% | red-700 | Party risk, blocked actions |

## Sizes

| Size | Padding | Font | Icon |
|---|---|---|---|
| `sm` (default) | `8px 8px` (`px-2 py-1.5`) | 11px medium | 12×12 |
| `xs` | `6px 6px` | 10px medium | 10×10 |

## Visual
- Radius: `8px` (`rounded-lg`) — NOT the pill radius; pill is reserved for [StatusPill](StatusPill.md)
- Icon + label, 4px gap
- Truncates with ellipsis when inside a tight flex row

## Shape exception
When used as a purely-textual flag (no count, no icon), can switch to `rounded-[16px]` and slightly larger padding — see `AccessBlock` urgent variant in cleaner-ui.

## States
- Static by default
- When wrapping a `<Link>`: hover `bg-[var(--muted)]/80`, focus-visible ring

## A11y
- Purely decorative when the adjacent text already carries meaning
- When the badge IS the meaning (e.g. "3 unread"), set `aria-label` with the full phrase

## Reference
- Web: inline chip utility classes in `CleanerJobCard` (bedroom/bathroom/guest rows) in [src/components/cleaner/cleaner-ui.tsx](../../src/components/cleaner/cleaner-ui.tsx) (~line 674)
- Mobile: covered by existing `ThemedBadge` component — will align to these variants in Phase 3
