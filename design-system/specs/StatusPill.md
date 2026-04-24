# StatusPill

## Purpose
Compact pill that communicates the current lifecycle state of a cleaning job in a single glance. One of four appearances.

## Inputs
- `appearance` — one of `open` | `in_review` | `completed` | `rework`
- `label` — localized text (e.g. "Assigned", "In review", "Completed", "Rework")

## Appearances

| Appearance | Background | Foreground | Covers raw statuses |
|---|---|---|---|
| `open` | `color.cleaner.primary` | white | `scheduled`, `assigned`, `in_progress`, `rework_required` (pre-review) |
| `in_review` | `color.cleaner.ink` | `color.cleaner.surface` | `awaiting_approval` |
| `completed` | `#111111` | white | `completed` |
| `rework` | destructive (red) | white | (rare — only for explicitly flagged rework that hasn't been re-acknowledged) |

See [`statusPillColors`](../tokens/colors.ts). Mapping from raw status → appearance lives in a helper (`mapJobAppearance`) that both platforms reimplement identically.

## Visual
- Shape: `rounded-full`
- Padding: `10px horizontal, 4px vertical` (`px-2.5 py-1`)
- Text: cleaner-meta font, `10px`, uppercase, `0.18em` letter-spacing
- No border, no shadow

## States
- Static indicator — no hover, focus, pressed, or disabled states.
- When inside an interactive card, the parent handles focus.

## A11y
- Decorative visual, does **not** need `role` — the label text is read by screen readers as inline text.
- Do not use color alone to convey meaning; the label text must always be present.
- Ensure 4.5:1 contrast ratio on all four backgrounds (verified for the current palette).

## Reference
- Web: `CleanerStatusPill` in [src/components/cleaner/cleaner-ui.tsx](../../src/components/cleaner/cleaner-ui.tsx) (~line 341)
- Mobile: to be created at `components/cleaner/StatusPill.tsx` (Phase 3)
