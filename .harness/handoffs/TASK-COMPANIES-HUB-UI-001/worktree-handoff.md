# TASK-COMPANIES-HUB-UI-001 — worktree handoff

- Branch: `task/companies-hub-refined-ui`
- PR: https://github.com/Atemndobs/ops-central/pull/195
- Schema impact: **none**
- Convex deploy needed after merge: **no** — zero Convex changes
- Mobile impact: **none** — admin-only component, not shared with cleaners app

## What changed
Single file: `src/components/companies/companies-hub.tsx`. Followed from a design critique of the live `/companies` detail panel (three redundant stat cards, an always-open attach form outweighing the member list, two different destructive-button styles in one view, and near-duplicate property lists). See conversation for the full critique and an interactive mockup that was approved before implementation.

- 3 stat cards → 1 compact summary bar (avatar + name + counts + Edit/Archive, moved out of the page header)
- Members: active-first grouping, colored role pill, inactive members collapsed under `<details>`
- Attach-user form: always-open → icon-trigger popover
- Assignment History panel + full-width Active Properties panel → merged into one Properties panel with an Active/History pill toggle
- Detach/Unassign: unified on one `destructiveGhostBtn` red-ghost className

No new state persisted beyond component-local `useState` (`isAttachOpen`, `propertiesView`); both reset via a `useEffect` keyed on `selectedCompanyId` so switching companies doesn't leak UI state.

## Verification done in worktree
- `npx tsc --noEmit`: clean
- `npx eslint src/components/companies/companies-hub.tsx`: clean
- `npm run build`: compiles successfully, all pages generated
- **Not done**: live browser click-through — Clerk auth wall in the automated preview and no test credentials available. The JSX/logic was reviewed carefully by hand against the original (same handlers, same Convex queries/mutations, no behavior removed except the redundant chrome).

## Integration steps for main session
1. Merge PR #195.
2. `git pull --rebase origin main`.
3. `npm run build` (sanity).
4. Load `/companies` in a real browser as an admin/property_ops user and click through: select a couple of companies, expand "N inactive" in Members, toggle Active/History in Properties, open the Attach popover and attach/detach a member, Edit and Archive flows still work with the confirm modal.
5. Write `integration-result.md`, mark queue entry Done, remove worktree.
