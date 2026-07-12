# Team Management — PR 2: Kill Company Membership block, inline assignment

**Date started:** 2026-05-27
**Branch:** `task/team-cleanup-membership`
**Worktree:** `~/sites/opscentral-admin-team-pr2`
**Status:** In progress

---

## Problem

After PR #169 (density + grouping), the `/team` page still has the **Company Membership** card section *above* the main table. This block:

- Renders one ~80px row per member (avatar + name + email + role + company + Change button)
- Duplicates data already in the main table (which now has a Company column)
- At 200 users → 200-row second list. The exact issue PR 1 was supposed to fix.

User pointed this out after PR 1 shipped: *"this is still the original issue"*.

---

## Plan

### In scope for PR 2

1. **Remove the Company Membership card section** entirely (`<section>...Company Membership...</section>` at the top of the page).
2. **Inline company assignment in main table**:
   - Click the Company cell (or an icon next to it) → opens existing `openCompanyEditor` modal
   - Cell shows `— Attach` link if unassigned (amber)
3. **Unassigned filter pill** in the filter bar:
   - `Unassigned (N)` chip next to the role/status filters
   - Click → filters the table to only unassigned members
   - Counter replaces the "X UNASSIGNED" label from the removed section
4. **Keep all existing modals/mutations** untouched (reuse `companyEditor` state and `assignUserCompanyMembership` mutation)

### NOT in scope (deferred to PR 3)

- Bulk select + bulk attach (needs new Convex mutation `bulkAssignCompanyMembership`)
- Saved segments / persisted filter views
- Server-side pagination

---

## Implementation log

| Time (local) | Event |
|---|---|
| 2026-05-27 ~early-AM | User flagged Company Membership block as redundant duplicate |
| 2026-05-27 ~early-AM | Created worktree `~/sites/opscentral-admin-team-pr2` on branch `task/team-cleanup-membership` off `origin/main` (a45bfa7) |
| 2026-05-27 ~early-AM | Wrote this plan doc before touching code |

---

## Test plan (for reviewer)

- [ ] Open `/team`, Company Membership card section is GONE
- [ ] Main table Company column shows company name OR `— Attach` (amber) if unassigned
- [ ] Click Company cell → existing Assign Company modal opens
- [ ] Save → row updates, table re-renders
- [ ] `Unassigned (N)` filter pill visible; counter matches the table
- [ ] Click `Unassigned` pill → table filters to unassigned only
- [ ] Click again → clears the filter
- [ ] Card view + mobile list view unchanged
- [ ] Roles: `admin` sees company column clickable; `manager` sees read-only

---

## Files touched

- `src/app/(dashboard)/team/page.tsx` (only)

## Files NOT touched

- `convex/**` (no mutation changes)
- All other modal components
- Auth gating logic

---

## Preferences honored

- ✅ One worktree per task (this is a fresh worktree)
- ✅ opscentral-admin main checkout untouched
- ✅ ~/sites root
- ✅ Persist plan to Docs/ BEFORE coding (this time on the first try)
