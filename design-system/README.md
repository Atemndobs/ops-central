# Design System

Canonical tokens and component specs for the J&A Business Solutions surfaces.

**Home:** `opscentral-admin/design-system/`
**Consumed by:** web (`opscentral-admin`) directly; mobile (`jna-cleaners-app`) via relative import once Phase 3 lands.
**Pilot:** cleaner-facing surfaces — `https://ja-bs.com/cleaner` (web PWA) and the `(cleaner)` routes in the mobile app.

---

## Why this exists

The web PWA and the Expo mobile app had diverged across primary color, status semantics, fonts, radii, and i18n keys. This folder is the single source of truth for tokens, and `specs/` describes each component's contract in language-neutral terms so both platforms can implement to the same visual result.

Related planning doc: [`apps-ja/docs/2026-04-24-unified-design-system-plan.md`](../../docs/2026-04-24-unified-design-system-plan.md).

---

## Layout

```
design-system/
├── README.md              ← this file
├── tokens/
│   ├── colors.ts          semantic color tokens (cleaner light/dark + admin)
│   ├── typography.ts      font families, weights, sizes, text styles
│   ├── spacing.ts         spacing scale, radii, shadows, layout constraints
│   ├── motion.ts          durations, easings, press scale
│   └── index.ts           barrel export
├── specs/                 language-neutral component specs (Markdown)
│   ├── README.md
│   ├── StatusPill.md
│   ├── CountdownBadge.md
│   ├── JobCard.md
│   ├── SummaryCard.md
│   ├── IconButton.md
│   ├── Section.md
│   ├── Button.md
│   ├── Badge.md
│   └── layout/
│       ├── MobileShell.md
│       └── BottomNav.md
└── adapters/
    ├── tailwind.md        how web consumes tokens (globals.css + Tailwind)
    └── react-native.md    how mobile consumes tokens (RN StyleSheet)
```

---

## Quick reference — cleaner palette

| Role | Light | Dark |
|---|---|---|
| `bg` | `#f2f2f2` | `#181426` |
| `surface` | `#ffffff` | `#241f37` |
| `ink` | `#333333` | `#f7f3ff` |
| `muted` | `#828282` | `#c3b5df` |
| `primary` | `#9b51e0` | `#bd77ff` |
| `primary-soft` | `#bd77ff` | `#9b51e0` |

Status pills: `open` (primary) · `in_review` (ink) · `completed` (#111) · `rework` (red).
Countdown tiers: `calm` (surface) · `soon` (primary) · `urgent` (red).
Card radius: **24px**. Button radius: **10px**. Shell max-width: **402px**.

Full token values live in [tokens/colors.ts](tokens/colors.ts), [tokens/typography.ts](tokens/typography.ts), [tokens/spacing.ts](tokens/spacing.ts), [tokens/motion.ts](tokens/motion.ts).

---

## Governance

- **Source of truth:** the files under `tokens/` are canonical. CSS variables in `src/app/globals.css` and mobile theme objects must derive from these values, not the other way around.
- **Changing a token:** edit `tokens/*.ts`, run the sync script (see `adapters/tailwind.md`), commit both the TS change and the generated CSS in the same commit. Both apps should render the new value after next build.
- **Adding a spec:** start from `specs/_TEMPLATE.md` (copy an existing spec if no template yet) and link it from this README. Specs describe behavior and visuals, never code.
- **Deprecation:** don't remove tokens in use. Mark `@deprecated` in TS jsdoc, migrate call sites, then remove in a follow-up commit.

---

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Tokens + specs + adapter docs | 🚧 in progress |
| 2 | Web adapter — `globals.css` sourced from tokens, no visual change | ⏳ pending |
| 3 | Mobile adapter + pilot screen migration (cleaner jobs flow) | ⏸ deferred — blocked on `feature/convex-migration` merge in `jna-cleaners-app` |

---

## Out of scope (for this pilot)

- Non-cleaner mobile screens
- Manager/admin web surfaces (dashboard, schedule, reports) — may adopt later
- Clerk sign-in theming (already aligned)
- Logo/brand consolidation (ChezSoi vs J&A decision pending — separate effort)
