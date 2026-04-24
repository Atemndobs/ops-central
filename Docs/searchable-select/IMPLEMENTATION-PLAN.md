# Implementation Plan — Searchable Select

**Date:** 2026-04-22
**Scope:** OpsCentral admin (Next.js) + cleaners app (Expo)
**Target:** one sprint (~2 weeks)

This plan turns [PRD](./PRD.md) + [ADR-001](./ADR-001-unified-searchable-select.md)
into concrete PRs. Each phase is a separate branch and PR so we can
ship one at a time.

## Phase 0 — Contract + assets (0.5 d)

**Branch:** `feature/searchable-select-contract`

Files to create:

- `apps-ja/opscentral-admin/src/components/ui/searchable-select/contract.ts`
- `apps-ja/jna-cleaners-app/components/ui/searchable-select/contract.ts`
- `apps-ja/opscentral-admin/Docs/searchable-select/assets/` — drop the
  screenshots from today's conversation here for posterity

`contract.ts`:

```ts
export type SearchableSelectItem<Meta = unknown> = {
  id: string;
  label: string;
  group?: string;
  hint?: string;
  disabled?: boolean;
  meta?: Meta;
};

export type SearchableSelectProps<Meta = unknown> = {
  items: SearchableSelectItem<Meta>[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  loading?: boolean;
  clearable?: boolean;
  disabled?: boolean;
  groupOrder?: string[];
  id?: string;
  name?: string;
  "aria-label"?: string;
};
```

Scripts:

- `opscentral-admin/scripts/verify-searchable-select-contract.sh` —
  `diff` the two contract files; exit 1 on mismatch. Wire into
  `predeploy` alongside `verify-mobile-api-compat.sh`.

**Exit criteria:** CI fails if contracts drift.

## Phase 1 — Web implementation (3 d)

**Branch:** `feature/searchable-select-web`
**Depends on:** Phase 0

### Install

```bash
cd apps-ja/opscentral-admin
npm i @radix-ui/react-popover cmdk @tanstack/react-virtual
```

### Files

```
src/components/ui/searchable-select/
  contract.ts             (from Phase 0)
  SearchableSelect.tsx    (≤ 250 lines)
  index.ts                (re-exports)
  SearchableSelect.test.tsx
```

### Implementation notes

- Use `cmdk`'s `<Command>` for the inner listbox. Its built-in
  filter is good enough; override only if we need to search both
  `label` and `hint` (we do — pass a custom `filter` fn).
- Group header rendered as `<Command.Group heading={group}>`.
- Virtualization: wrap `<Command.List>` rows with
  `useVirtualizer` when `filteredItems.length > 100`.
- Trigger styled as the existing
  `rounded-md border bg-[var(--card)] px-2 py-1.5 text-sm` to match
  inputs on the same row.
- Expose a `data-testid` on trigger and each row for Playwright.

### Tests (`node --test`)

- Renders placeholder when `value` is null.
- Shows selected label when `value` matches an item.
- Opens on click, focuses the search input.
- Filters by label (case-insensitive) and by hint.
- `Enter` on highlighted row fires `onChange(id)`.
- `Esc` closes without calling `onChange`.
- Clear button fires `onChange(null)` when `clearable`.
- Virtualizer engages at 101 items (assert DOM count < items.length).

### Storybook or playground

No Storybook today — add a dev-only page at
`src/app/(dashboard)/__playground/searchable-select/page.tsx`
(gated by `process.env.NODE_ENV !== 'production'`) so designers and
engineers can poke it with 10, 100, 2000 items.

**Exit criteria:** tests green; playground page renders all three
sizes without jank.

## Phase 2 — Migrate the pain point (0.5 d)

**Branch:** `feature/searchable-select-checkpoints`
**Depends on:** Phase 1

Replace the `<select>` at
`src/components/properties/property-critical-checkpoints-panel.tsx:232-248`.

```tsx
<SearchableSelect
  value={draft.linkedInventoryItemId || null}
  onChange={(id) =>
    setDraft((prev) => ({ ...prev, linkedInventoryItemId: id ?? "" }))
  }
  placeholder="Link inventory item (optional)"
  searchPlaceholder="Search inventory…"
  clearable
  items={(inventoryItems ?? []).map((item) => ({
    id: item._id,
    label: item.name,
    group: item.room || "Ungrouped",
    hint: item.quantity ? `${item.quantity}` : undefined,
  }))}
/>
```

Verify in browser:

- Opens as a popover attached to the trigger.
- Search "towel" narrows to towel items.
- Groups render with `All Bathrooms`, `Bedroom 1`, etc.
- Selecting commits to `draft.linkedInventoryItemId`.
- Clearing sets it back to `""`.
- Playwright smoke test covering the above.

**Exit criteria:** property detail page ships with the new picker; no
regressions in existing checkpoint create / edit / delete flows.

## Phase 3 — Mobile implementation (3 d)

**Branch:** `feature/searchable-select-mobile`
**Depends on:** Phase 0 (can run in parallel with Phase 1/2)

### Install

```bash
cd apps-ja/jna-cleaners-app
npm i @gorhom/bottom-sheet
# react-native-gesture-handler & reanimated already present
```

### Files

```
components/ui/searchable-select/
  contract.ts             (Phase 0, duplicated)
  SearchableSelect.tsx    (≤ 300 lines)
  index.ts
  SearchableSelect.test.tsx
```

### Implementation notes

- `BottomSheetModal` with snap points `["60%", "90%"]`.
- Pin a `<TextInput>` at the top of the sheet; `autoFocus` on open.
- Use `SectionList` when any item has a `group`, else `FlatList`.
- Row minHeight = 48.
- Selected row: leading check icon (lucide-react-native), no fill.
- Close button in sheet header.
- Reuse the filter logic from web by exporting a pure `filterItems()`
  helper from a shared util — we duplicate just the function (same
  rules as contract).

### Tests (jest-expo)

- Same behavior matrix as web (adapted to RN Testing Library).

**Exit criteria:** renders on iOS + Android dev build; same filter
outputs as web for a shared fixture.

## Phase 4 — Roll out to remaining call sites (2 d)

**Branch:** `feature/searchable-select-rollout`
**Depends on:** Phases 2 & 3

Audit all `<select>` in both apps:

```bash
# web
grep -rn "<select" apps-ja/opscentral-admin/src --include="*.tsx"
# mobile
grep -rn "Picker\|SelectList" apps-ja/jna-cleaners-app --include="*.tsx"
```

For each, decide:

| Items | Action |
|-------|--------|
| < 8, fixed | keep native `<select>` |
| 8–20 | migrate to `SearchableSelect` (search helps but not critical) |
| > 20 | migrate, mandatory |

Known call sites to migrate (from PRD §2):

- [ ] Job detail → Assign cleaner
- [ ] Incident drawer → Reported by
- [ ] Reports → Property filter
- [ ] Inventory import → Category
- [ ] Cleaner app → pick inventory item when reporting low stock
- [ ] Cleaner app → pick room when creating incident

Each migration is one small commit in this single branch (or split if a
call site needs data-shape work).

**Exit criteria:** no `<select>` with > 20 options remains in either
app; every migrated site has a smoke test.

## Phase 5 — Observability + docs (0.5 d)

**Branch:** `feature/searchable-select-analytics`

- Fire a PostHog event `searchable_select_opened` with
  `{ surface, itemCount }` on trigger-click.
- Fire `searchable_select_selected` with `{ surface, searchLength,
  positionInList, itemCount }`.
- Update the OpsCentral `README.md` / this folder's `README.md` with
  usage examples and "when to use native vs. SearchableSelect".

**Exit criteria:** events show up in PostHog for one day; docs updated.

## Risk log

| Risk | Mitigation |
|------|-----------|
| `cmdk` filter picks a bad match for grouped items | Custom `filter` fn tested on a 2k-item fixture derived from prod inventory |
| Bottom sheet keyboard behavior on Android is flaky | Use `@gorhom/bottom-sheet`'s `KeyboardAvoidingView` integration; test on Pixel + low-end Samsung |
| Radix Popover z-index clashes with Clerk modals | Portal the popover into `document.body` and assert over Clerk's z-indices; manual test in sign-in modal adjacency |
| Contract drift between apps | CI diff check added in Phase 0 |
| Virtualization breaks keyboard nav | Only enable > 100 items; keep `scrollIntoView` on highlight change |

## Rollback

Each phase is a single PR. To revert, `git revert <merge-sha>`; the
old `<select>` stays in place for migrated sites because we'll land
replacements as the migration PRs, not in-place edits of the new
component.

## Not in this plan

- Multi-select variant.
- Creatable options.
- Async / server-side search.
- Extracting contract into a real workspace package.

These are tracked in the PRD §Out-of-scope follow-ups and will each
get their own ADR if prioritized.

## Checklist

- [ ] Phase 0 — contract + CI check
- [ ] Phase 1 — web component + tests + playground
- [ ] Phase 2 — checkpoints migration (pain point)
- [ ] Phase 3 — mobile component + tests
- [ ] Phase 4 — rollout to remaining call sites
- [ ] Phase 5 — analytics + docs
