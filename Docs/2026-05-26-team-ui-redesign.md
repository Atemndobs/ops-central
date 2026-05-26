# Team Management UI Redesign — Progress Log

**Date started:** 2026-05-26
**Branch:** `task/team-redesign`
**Worktree:** `~/sites/opscentral-admin-team-redesign`
**PR:** [#169](https://github.com/Atemndobs/ops-central/pull/169)
**Status:** PR open, awaiting review

---

## Problem

`/team` (Team Management page) does not scale past ~20 users.

- Each row ≈80px tall (5 visible without scroll)
- 4 large KPI tiles + right rail (Leaderboard + Shift Intelligence) eat ~40% of viewport
- "Change" button on every row opens a modal — no bulk actions
- No grouping, no density toggle, no saved views

Source: live audit of `https://app.chezsoistays.com/team` with 5 members. User flagged: *"if we have 200 users this UI will be TERRIBLE for usability."*

---

## Phased plan

### PR 1 (this one) — UI density only, no logic changes

1. ✅ Collapse 4 KPI tiles → slim header strip
2. ✅ Density toggle (`Comfortable` | `Compact`) on List view
3. ✅ Group-by-Company toggle, collapsible sections, Unassigned pinned amber
4. ✅ Right rail (Leaderboard + Shift Intelligence) collapsible, closed by default
5. ✅ Always-visible Company column in flat mode

**Reuses** all existing modals + Convex mutations untouched.

### PR 2 — Bulk actions (deferred)

- Checkbox column + select-all
- New Convex mutation: `bulkAssignCompanyMembership({ userIds, companyId })`
- Bulk: change role, deactivate, attach to company

### PR 3 — Saved segments (deferred)

- Filter chips: `Unassigned`, `Inactive 30d`, `Top performers`
- Persist user-defined segments (Convex table `teamViews`)

### PR 4 — Server-side scale (deferred until >100 users)

- Paginated `teamMetrics` query
- Fuzzy server-side search on name/email/company

---

## Implementation log

| Time (local) | Event |
|---|---|
| 2026-05-26 ~16:30 | User flagged usability issue with screenshots of `/team` |
| 2026-05-26 ~16:35 | Proposed phased plan, user approved + set `/goal` to complete PR 1 |
| 2026-05-26 ~16:40 | Created worktree `~/sites/opscentral-admin-team-redesign` off `origin/main`, branch `task/team-redesign` |
| 2026-05-26 ~16:45 | Mapped `src/app/(dashboard)/team/page.tsx` (2076 lines, single file) — KPI tiles at L883–914, rail at L1347, list table at L1249 |
| 2026-05-26 ~16:50 | Added state + localStorage keys: `density`, `groupBy`, `railOpen`, `collapsedGroups` |
| 2026-05-26 ~16:55 | Replaced 4-tile KPI grid with `StatChip` row, removed unused `StatBox` |
| 2026-05-26 ~17:00 | Added Comfortable/Compact + Group: Company toggle row alongside Card/List |
| 2026-05-26 ~17:05 | Built `groupedMembers` memo, made desktop table density-aware + group-header-aware |
| 2026-05-26 ~17:10 | Wrapped right rail in collapsible toggle (closed by default) |
| 2026-05-26 ~17:15 | `npm install` in worktree, `npx tsc --noEmit` clean (only unrelated vitest error in convex tests) |
| 2026-05-26 ~17:20 | `npm run build` exit 0 after copying `.env.local` from main checkout |
| 2026-05-26 ~17:22 | Commit `dd9880b`: 1 file, +302/-84 |
| 2026-05-26 ~17:23 | Pushed `task/team-redesign`, opened PR #169 |

---

## Files touched

- `src/app/(dashboard)/team/page.tsx` — only file changed in PR 1

## Files NOT touched (intentional)

- `convex/**` — no schema or mutation changes
- All modal components (role/profile/company/job/property editors)
- Mobile (<768px) layouts
- Card view
- Auth gating logic

---

## Test plan (for reviewer)

- [ ] Open `/team`, slim chip strip renders 4 stats
- [ ] List view → density toggle visible, switch Compact ↔ Comfortable
- [ ] Compact rows ~36px, Email column visible, single line per row
- [ ] `Group: Company` toggle → company headers, Unassigned amber at top
- [ ] Click company header → collapse/expand
- [ ] Open/close `Insights & Leaderboard` rail
- [ ] Refresh → density + groupBy + railOpen persist
- [ ] Click row → existing action sheet opens unchanged
- [ ] Card view unchanged
- [ ] Mobile list unchanged
- [ ] Roles: `admin`, `property_ops`, `manager`

---

## Open questions

1. Should `groupBy: "company"` be the default for `admin` (the role that manages company membership)?
2. Do we want a `Group: Role` option too (cleaner / manager / property_ops)?
3. Bulk actions priority — PR 2 next, or wait until roster grows?

---

## Related preferences honored

- ✅ [One worktree per task](../memory/preference_worktree_per_task.md) — used worktree, did not edit on main checkout
- ✅ [opscentral-admin checkout stays on main](../memory/preference_stay_on_main.md) — main checkout untouched
- ✅ [Always start projects in ~/sites](../memory/preference_sites_directory.md) — worktree at `~/sites/opscentral-admin-team-redesign`
- ❌ → ✅ [Persist plans to Docs/](../memory/feedback_persist_plans_to_docs.md) — **missed initially**, added this doc retroactively after user reminder
