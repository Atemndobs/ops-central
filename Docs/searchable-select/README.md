# Searchable Select — Design & Implementation

> Unified dropdown / picker component for long lists across web (Next.js admin)
> and mobile (Expo cleaners app).
>
> Status: **Proposed** — 2026-04-22

## Problem

The Critical Checkpoints form on the Property detail page shows a native
`<select>` that lists every inventory item for a property. A typical
furnished rental has **80–200+ inventory rows**, producing a dropdown that:

- Scrolls off screen (see screenshots in `./assets/`)
- Has no search — users must eye-scan 200 rows to find "Toilet paper"
- Uses OS-native styling — looks different on macOS Safari vs. Chrome vs. iOS
- Cannot group / filter by room
- Has no mobile-friendly equivalent in the cleaners app

This pattern repeats across the codebase:

| Location | Items | Current control |
|----------|-------|----------------|
| Checkpoints → Link inventory item | 80–200 | native `<select>` |
| Job detail → Assign cleaner | 10–40 | native `<select>` |
| Incident → Reported by | 10–40 | native `<select>` |
| Reports → Property filter | 5–50 | native `<select>` |
| Inventory import → Category | 10–30 | native `<select>` |

We need **one** component contract that works on web and mobile, handles
long lists gracefully, and renders consistently across browsers and OSes.

## Documents in this folder

| File | Purpose |
|------|---------|
| [`PRD.md`](./PRD.md) | Product requirements — what it must do, who uses it |
| [`ADR-001-unified-searchable-select.md`](./ADR-001-unified-searchable-select.md) | Architecture decision: library choice, web/mobile split, API contract |
| [`IMPLEMENTATION-PLAN.md`](./IMPLEMENTATION-PLAN.md) | Step-by-step rollout with phases, PR breakdown, and migration strategy |
| `assets/` | Screenshots of the current broken dropdown |

## TL;DR of the proposal

1. Define **one TypeScript contract** (`SearchableSelectProps`) shared by
   both apps.
2. **Web** implementation: Radix `Popover` + `cmdk` + `react-virtual` for
   long lists. Styled with Tailwind to match the existing dark UI.
3. **Mobile** implementation: bottom sheet + `FlatList` + search input.
4. Both sides ship the same ergonomics: search, optional grouping
   (`room`), keyboard/touch navigation, empty state, loading state,
   clear button.
5. Roll out behind a single `SearchableSelect` import in each app, one
   call site at a time. Start with the checkpoint panel (highest pain).

See [`ADR-001`](./ADR-001-unified-searchable-select.md) for the full
rationale.
