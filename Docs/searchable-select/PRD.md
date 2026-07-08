# PRD — Searchable Select Component

**Date:** 2026-04-22
**Author:** OpsCentral design / engineering
**Status:** Proposed

## 1. Summary

A single reusable component — `SearchableSelect` — that replaces every
native `<select>` whose option list can exceed ~10 items, across both
the OpsCentral admin (Next.js) and the cleaners mobile app (Expo).

## 2. Users and use cases

| User | Where they hit it | Typical list size |
|------|-------------------|-------------------|
| Property ops admin | Link inventory item to checkpoint | 80–200 |
| Property ops admin | Assign cleaner to a job | 10–40 |
| Property ops admin | Filter reports by property | 5–50 |
| Manager | Pick reporter on incident | 10–40 |
| Cleaner (mobile) | Pick inventory item when reporting low stock | 80–200 |
| Cleaner (mobile) | Pick room when creating incident | 4–20 |

Common pain today:

- Scrolling 200 items to find one.
- No search.
- Items visually identical — no secondary metadata (room, unit, SKU).
- Inconsistent look web vs. mobile vs. different browsers.

## 3. Goals

1. **Find by typing** — search filters the list in < 50 ms for up to 2k
   items.
2. **Group support** — items can be grouped under a header (e.g. by
   room: `All Bathrooms`, `Kitchen`, `Bedroom 1`). Headers are not
   selectable.
3. **Secondary text** — each row can render a muted right-aligned
   hint (e.g. quantity, SKU, room tag).
4. **Clearable** — a single click / tap clears the selection when the
   field is optional.
5. **Keyboard-complete on web** — `↑ ↓ Enter Esc` + type-to-filter.
6. **Touch-friendly on mobile** — opens in a bottom sheet, search input
   auto-focused, row height ≥ 44 pt.
7. **Identical API** on web and mobile so the same prop shape ports.
8. **Visually unified** — dark theme, Geist typography, matches
   existing OpsCentral chrome.

## 4. Non-goals

- Multi-select (out of scope for v1 — tracked as follow-up).
- Creatable options (typing a new value). Not needed today.
- Async server-side search. All lists today are already in memory via
  Convex subscriptions. Revisit if a list exceeds 5k items.
- Replacing native `<select>` for boolean / 2–5 option pickers where
  the native control is fine.

## 5. Functional requirements

### 5.1 Contract (language-agnostic)

```
SearchableSelect<T>
  items: { id, label, group?, hint?, disabled?, meta?: T }[]
  value: id | null
  onChange: (id | null) => void
  placeholder?: string
  searchPlaceholder?: string   // default "Search…"
  emptyText?: string           // default "No matches"
  loading?: boolean
  clearable?: boolean          // default true
  disabled?: boolean
  groupOrder?: string[]        // explicit group order; else input order
  renderRow?: (item) => ReactNode   // escape hatch for custom rows
  id?, name?, aria-label?
```

### 5.2 Behavior

- Opening the control focuses the search input.
- Type narrows the visible list (case-insensitive, matches `label` and
  `hint`). Matches are **not** reordered — filtered in place so grouping
  stays intuitive.
- Arrow keys move the highlight; `Enter` selects; `Esc` closes without
  changing value.
- Empty query renders the full list, grouped.
- Selected row shows a check mark.
- When `clearable` and a value is set, a small `×` appears on the
  trigger and inside the panel.
- Panel height capped at `min(60vh, 420px)` with internal scroll.
- Lists over 100 items use virtualization.

### 5.3 Accessibility

- Trigger: `role="combobox"`, `aria-expanded`, `aria-controls`,
  `aria-haspopup="listbox"`.
- List: `role="listbox"`; rows `role="option"` with `aria-selected`.
- Group headers: `role="presentation"` (ignored by AT) + the following
  options get `aria-describedby` pointing at the header.
- WCAG AA contrast in dark mode (our default).
- Mobile: the bottom sheet traps focus and exposes a close button.

### 5.4 Performance targets

| Metric | Target |
|--------|--------|
| Open-to-visible (p95, 2k items) | < 120 ms |
| Keystroke-to-filter (p95, 2k items) | < 50 ms |
| Bundle cost on web | ≤ 15 kB gzip added to first load |

## 6. Visual design (dark theme)

```
┌────────────────────────────────────────────────┐
│  Link inventory item (optional)          ⌄    │   ← trigger
└────────────────────────────────────────────────┘
   │
   ▼  popover (web) / bottom sheet (mobile)
┌────────────────────────────────────────────────┐
│  🔍  Search items…                          ×  │
├────────────────────────────────────────────────┤
│  ALL BATHROOMS                                 │
│    Toilet paper (30 rolls)              🧻  ✓  │  ← highlighted
│    Bath towels 12                       12 pk  │
│    Hand towels 6-pack                    6 pk  │
│  BEDROOM 1                                     │
│    Queen Mattress 12″                          │
│  …                                             │
├────────────────────────────────────────────────┤
│  238 items                                     │
└────────────────────────────────────────────────┘
```

- Trigger uses the same `rounded-md border bg-[var(--card)]` as today's
  text inputs — no new styling language.
- Group headers: 11 px, uppercase, muted.
- Rows: 14 px, 40 px min height on web, 48 px on mobile.
- Check mark is the only selected-state affordance (no background fill),
  to keep the list scanable.

## 7. Success metrics

- **Time to find an inventory item** (measured via PostHog on the
  checkpoint form) drops from the current anecdotal "scroll through 200"
  to median < 3 s.
- Zero new accessibility violations reported by Lighthouse on pages
  using the component.
- All six call sites in §2 migrated within one sprint of v1 shipping.

## 8. Out-of-scope follow-ups

- Multi-select variant (`SearchableMultiSelect`).
- Inline "create new" action (for adding a missing inventory item).
- Server-driven async search (only needed if a list passes ~5k items).
