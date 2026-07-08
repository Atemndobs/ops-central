# ADR-001 — Unified Searchable Select

**Date:** 2026-04-22
**Status:** Proposed
**Deciders:** OpsCentral engineering
**Supersedes:** none

## Context

Native `<select>` elements are the default dropdown in both
OpsCentral (web) and the cleaners app (mobile/PWA). The UX degrades
badly when the list grows:

- The inventory-item picker on the Critical Checkpoints panel lists
  80–200 items with no search. Users scan by eye.
- Native `<select>` styling is OS- and browser-controlled, so we cannot
  match the dark theme of the rest of the app.
- React Native on Expo does not ship a searchable `<Picker>` out of the
  box, so the mobile app currently re-implements pickers inconsistently.

We need one component abstraction that works in both codebases.

## Decision

Adopt a single `SearchableSelect` component with a shared TypeScript
contract, implemented twice (web + mobile) because the render targets
don't share primitives:

```
packages/ui-select/
  src/
    contract.ts            <-- shared types (copied into both apps)

apps-ja/opscentral-admin/src/components/ui/searchable-select/
  index.ts                 <-- re-export
  SearchableSelect.tsx     <-- Radix Popover + cmdk + react-virtual
  styles.module.css

apps-ja/jna-cleaners-app/components/ui/searchable-select/
  index.ts
  SearchableSelect.tsx     <-- BottomSheet + FlatList
```

Because we don't yet have a shared package workspace, the contract
lives as a plain `.ts` file duplicated in both apps and kept in sync by
a pre-commit check (see §Implementation → cross-app contract). Moving
it to a real package is a follow-up once we have a second shared
component.

### Web implementation

- **Trigger:** custom `<button>` styled with Tailwind, matches existing
  `rounded-md border bg-[var(--card)]` inputs.
- **Popover positioning:** [`@radix-ui/react-popover`](https://www.radix-ui.com/primitives/docs/components/popover)
  — headless, handles focus trap, collision detection, portaling.
- **Command menu internals:** [`cmdk`](https://cmdk.paco.me/) — gives
  us the search filter, keyboard navigation, `role="listbox"`, grouping,
  all accessibility-ready.
- **Virtualization:** `@tanstack/react-virtual` only when
  `items.length > 100`. Below that, the DOM cost is negligible and
  virtualization hurts keyboard navigation.
- **Bundle cost:** Radix Popover (~5 kB gz) + cmdk (~4 kB gz) +
  react-virtual (~3 kB gz) = ~12 kB gz. Within our 15 kB budget.

### Mobile implementation

- **Trigger:** themed `<Pressable>` matching the existing
  `components/inventory/*` look.
- **Panel:** [`@gorhom/bottom-sheet`](https://gorhom.github.io/react-native-bottom-sheet/)
  — already an ecosystem standard, supports snap points and keyboard
  avoidance.
- **List:** `FlatList` with `getItemLayout` for cheap virtualization.
- **Search input:** standard `TextInput` pinned to the top of the
  sheet; `autoFocus` on open.
- **Grouping:** use `SectionList` when `items[].group` is present;
  otherwise plain `FlatList`.

### Cross-app contract

A single `searchable-select.contract.ts` is **duplicated** into both
apps. A script `scripts/verify-searchable-select-contract.sh` diffs the
two files in CI and fails the build if they drift:

```bash
diff \
  apps-ja/opscentral-admin/src/components/ui/searchable-select/contract.ts \
  apps-ja/jna-cleaners-app/components/ui/searchable-select/contract.ts
```

When we set up a real workspace/monorepo package, we extract the
contract (and any other shared types) into `packages/ui-contracts/`.

## Alternatives considered

### A. `shadcn/ui` `Combobox` recipe

shadcn's Combobox is essentially Radix Popover + cmdk, which is what
we're choosing. The difference is we lift the composition into our own
component rather than copy-pasting the recipe at every call site. Call
sites get a single `<SearchableSelect items={…} />`, not four
sub-components they must wire up correctly each time.

**Rejected:** the recipe is the same tech, but distributing it as a
recipe means every call site has its own copy-paste of 60 lines of
JSX — defeats the "uniform" requirement.

### B. Downshift

[Downshift](https://www.downshift-js.com/) is a mature combobox
primitive. Heavier than cmdk, less ergonomic grouping support, and
doesn't include a listbox component — we'd still need Radix Popover
around it. No advantage over cmdk for our use case.

**Rejected.**

### C. Headless UI (`@headlessui/react`)

Uses render-props that don't mesh well with Tailwind 4's utility-first
approach, and Combobox lacks grouping.

**Rejected.**

### D. Native `<datalist>` / fall-forward to HTML primitives

Zero bundle cost, but `<datalist>` styling is still OS-controlled and
breaks on iOS Safari for grouped lists. Kills the "uniform look"
requirement.

**Rejected.**

### E. Reuse the Clerk or Convex admin dropdown

Neither ships a standalone picker we can consume.

**Rejected.**

### F. Build fully from scratch (no libs)

Two weeks of work to replicate accessibility, focus trapping, collision
detection, virtualization. No upside vs. Radix + cmdk.

**Rejected.**

### G. Unified React-Native-Web component

Theoretically one codebase via `react-native-web`. Requires introducing
RN as a dep in the Next.js app, and the bottom-sheet / popover paradigms
differ so much that the "unified" code is `if (Platform.OS === 'web')`
branches anyway. Not worth the build tooling change.

**Rejected.**

## Consequences

### Positive

- Two implementations, one contract — call-site code is identical in
  both apps.
- Zero change to call-site imports beyond `<select>` →
  `<SearchableSelect>`.
- We can migrate one call site at a time with no regression risk; old
  `<select>` keeps working next to the new component.
- Dark-theme rendering is consistent across Safari, Chrome, Firefox,
  Edge, iOS, Android.

### Negative / cost

- Two implementations to maintain when behavior changes (search logic,
  grouping rules). Mitigated by the shared contract + a shared test
  fixture (same items, same expected filter output).
- Adds ~12 kB gz to the web first-load. Acceptable (total budget
  unaffected).
- Adds `@gorhom/bottom-sheet` to the mobile app if not already present.

### Neutral

- This is a UI component only. No backend schema, no Convex changes.
  Rollout risk is limited to visual regressions at each call site.

## Follow-ups

- Extract the contract into a real shared package once we add a second
  shared component.
- Add multi-select variant (`SearchableMultiSelect`) when the first use
  case lands (likely: "assign multiple cleaners to a job").
- Add creatable variant when inventory quick-add is prioritized.
