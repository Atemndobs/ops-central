# Team Page Restructure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the overloaded `/team` page into a focused users-only page (drill-down right drawer) and move all company-membership management into `/companies/[id]`, so admins can do one thing at a time.

**Architecture:** Frontend-only reorganization. No schema changes. Existing Convex mutations (`createUser`, `updateUser`, `assignUserCompanyMembership`, `assignPropertyToCompany`) are reused. The `/team` route URL stays. Membership management moves from a sibling card on `/team` into a Members tab on `/companies/[id]`. A right-side drawer (radix dialog / shadcn Sheet) replaces the inline action sheet on `/team` for per-user editing.

**Tech Stack:** Next.js 16 (App Router), Tailwind, shadcn/ui (`Sheet` component for the drawer), Convex React hooks, Clerk (for invites).

**Scope of this plan:** Phases A–D below. Bulk actions, saved segments, server-side pagination remain deferred (the original PRs 2–4 from the previous plan).

**Out of scope:** schema migrations, owner portal changes, mobile (<768px) layout changes, Convex backend changes other than wiring already-existing mutations.

---

## File Structure

### Files to create

- `src/components/team/team-detail-drawer.tsx` — right-side drawer showing identity / company / properties / activity for a selected user. shadcn `Sheet` component, `side="right"`, width `sm:max-w-xl`.
- `src/components/team/team-detail-drawer.types.ts` — drawer prop types (`MemberDetailTarget`, `DrawerAccordionSection`).
- `src/components/team/invite-user-wizard.tsx` — 3-step invite flow (email+name → role → optional company attach). Uses existing `createUser` mutation. Supports `role: "unassigned"`.
- `src/components/companies/company-members-tab.tsx` — extracted Company Membership management UI. Lists members of one company, attach/detach actions. Used inside `CompaniesHub` detail pane.
- `Docs/2026-06-01-team-page-restructure-progress.md` — progress log (created at start, appended after each task).

### Files to modify

- `src/app/(dashboard)/team/page.tsx` — remove Company Membership card section (lines ~1046–1107). Replace existing per-row action sheet with the new `TeamDetailDrawer`. Remove 4-KPI tile area (lines ~883–914 prior reference — re-check). Keep density/group toggles and slim chip strip. Add `+ Invite` button that opens `InviteUserWizard`. Filter chips: `Unassigned (platform role)`, `Unassigned (company)`, `Inactive 30d`.
- `src/components/companies/companies-hub.tsx` — render `<CompanyMembersTab />` inside the company detail pane (after the existing assignments section, around line 720+).
- `convex/_generated/` — no changes. (Lists here only to be explicit: no backend touch.)

### Files NOT to touch

- `convex/schema.ts`
- `convex/admin/mutations.ts` — all needed mutations already exist
- The cleaner PWA (`/cleaner` routes)
- Owner portal (`/owner` routes)

---

## Task 1: Worktree + progress log

**Files:**
- Create: `Docs/2026-06-01-team-page-restructure-progress.md`

- [ ] **Step 1: Verify we're on the right branch in a worktree**

Run: `git rev-parse --abbrev-ref HEAD && git worktree list`
Expected: current branch is `task/team-restructure` (or a fresh branch created off `origin/main`); the path shown matches `~/sites/opscentral-admin-team-redesign` or a new sibling worktree.

If not, create a new worktree per `preference_worktree_per_task.md`:
```bash
cd ~/sites/opscentral-admin
git worktree add ~/sites/opscentral-admin-team-restructure -b task/team-restructure origin/main
cd ~/sites/opscentral-admin-team-restructure
npm install
```

- [ ] **Step 2: Create progress log**

Write `Docs/2026-06-01-team-page-restructure-progress.md` with: Goal, Branch, Worktree, PR (TBD), Status, empty Implementation log table with columns `Time | Event`.

- [ ] **Step 3: Commit**

```bash
git add Docs/2026-06-01-team-page-restructure-progress.md Docs/2026-06-01-team-page-restructure-plan.md
git commit -m "docs(team): add restructure plan + progress log"
```

---

## Task 2: Extract drawer scaffold (no behavior change yet)

Build the empty drawer container with shadcn `Sheet`. Wire it open/close from `/team` row click. No data shown yet — drawer just opens with the selected user's name in the title.

**Files:**
- Create: `src/components/team/team-detail-drawer.types.ts`
- Create: `src/components/team/team-detail-drawer.tsx`
- Modify: `src/app/(dashboard)/team/page.tsx`

- [ ] **Step 1: Confirm shadcn Sheet is available**

Run: `ls src/components/ui/sheet.tsx 2>/dev/null && echo OK || echo NEEDS_INSTALL`
Expected: `OK`. If `NEEDS_INSTALL`, run `npx shadcn@latest add sheet`.

- [ ] **Step 2: Write drawer types**

```ts
// src/components/team/team-detail-drawer.types.ts
import type { Id } from "@/../convex/_generated/dataModel";

export type MemberDetailTarget = {
  _id: Id<"users">;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  role: string;
  companyId: Id<"companies"> | null;
  companyName: string | null;
  companyMemberRole: string | null;
};

export type DrawerAccordionSection = "identity" | "company" | "properties" | "activity";
```

- [ ] **Step 3: Write the empty drawer component**

```tsx
// src/components/team/team-detail-drawer.tsx
"use client";

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import type { MemberDetailTarget } from "./team-detail-drawer.types";

type Props = {
  member: MemberDetailTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function TeamDetailDrawer({ member, open, onOpenChange }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{member?.name || member?.email || "Member"}</SheetTitle>
          <SheetDescription>{member?.email}</SheetDescription>
        </SheetHeader>
        {/* Sections added in Task 3 */}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 4: Wire drawer into /team**

In `src/app/(dashboard)/team/page.tsx`:
1. Import `TeamDetailDrawer` and `MemberDetailTarget`.
2. Add state: `const [drawerMember, setDrawerMember] = useState<MemberDetailTarget | null>(null);`
3. On each row click (table + card view), call `setDrawerMember(toMemberDetailTarget(member))` instead of opening the existing action sheet (keep old action sheet behind a feature flag or as a fallback for now — guard with `if (FEATURE_DRAWER)` constant set to `true`).
4. Render `<TeamDetailDrawer member={drawerMember} open={!!drawerMember} onOpenChange={(o) => !o && setDrawerMember(null)} />` at the bottom of the page tree.

- [ ] **Step 5: Manual smoke test**

Run: `npm run dev` and visit `http://localhost:3000/team`. Click a row. Expected: right drawer slides in with the user's name and email. Close (`Esc` / overlay click) returns to list.

- [ ] **Step 6: Typecheck + lint**

Run: `npx tsc --noEmit 2>&1 | grep -E "team/page|team-detail-drawer" | head -20`
Expected: no errors mentioning these files.

Run: `npm run lint -- --max-warnings=0 src/app/\(dashboard\)/team src/components/team`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/team src/app/\(dashboard\)/team/page.tsx
git commit -m "feat(team): add empty right-drawer scaffold, wire to row click"
```

---

## Task 3: Populate drawer with 4 accordion sections

Move per-user editing (role, profile, deactivate, company-membership-shortcut) from the old action sheet into the drawer. Keep the old action sheet code untouched for now (we delete it in Task 7).

**Files:**
- Modify: `src/components/team/team-detail-drawer.tsx`

- [ ] **Step 1: Identify the existing handlers**

Run: `grep -n "openRoleEditor\|openProfileEditor\|openCompanyEditor\|deactivateMember" src/app/\(dashboard\)/team/page.tsx | head -20`
Note the function names; pass these as props into the drawer so the drawer triggers existing modals.

- [ ] **Step 2: Extend drawer props**

```ts
type Props = {
  member: MemberDetailTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEditRole: (m: MemberDetailTarget) => void;
  onEditProfile: (m: MemberDetailTarget) => void;
  onEditCompany: (m: MemberDetailTarget) => void;
  onDeactivate: (m: MemberDetailTarget) => void;
};
```

- [ ] **Step 3: Add 4 accordion sections**

Inside `SheetContent`, render shadcn `Accordion` (`type="single"`, `collapsible`, `defaultValue="identity"`):

1. **Identity** — avatar, name, email, role badge. Button: "Edit identity" → `onEditProfile(member)` / "Change role" → `onEditRole(member)` / "Deactivate" → `onDeactivate(member)`.
2. **Company membership** — current company + inner role. Button: "Change company" → `onEditCompany(member)`. If unassigned, show amber "No company assigned" with `Attach` button.
3. **Properties** — read-only count + link `/properties?assignedTo=<userId>`. (Detail later — placeholder text is fine.)
4. **Activity** — read-only summary `Jobs this week / Quality score` from the existing `summary` data if available; otherwise placeholder.

If `Accordion` is not available, run `npx shadcn@latest add accordion`.

- [ ] **Step 4: Pass handler props from /team page**

In `team/page.tsx`, pass the existing `openRoleEditor`, `openProfileEditor`, `openCompanyEditor`, and the deactivate handler into the drawer.

- [ ] **Step 5: Smoke test all 4 sections**

`npm run dev` → click a user → expand each accordion → click each action → verify the existing modal opens correctly (because we're reusing existing handlers, behavior should be identical to the old action sheet).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep team-detail-drawer`
Expected: empty.

- [ ] **Step 7: Commit**

```bash
git add src/components/team/team-detail-drawer.tsx src/app/\(dashboard\)/team/page.tsx
git commit -m "feat(team): populate drawer with identity/company/properties/activity sections"
```

---

## Task 4: Extract Company Members tab into /companies

Move the Company Membership card from `/team` to `/companies/[id]`. The card UI becomes a new component used inside `CompaniesHub`.

**Files:**
- Create: `src/components/companies/company-members-tab.tsx`
- Modify: `src/components/companies/companies-hub.tsx`
- Modify: `src/app/(dashboard)/team/page.tsx` (delete Company Membership section)

- [ ] **Step 1: Identify the source block**

Run: `grep -n "Company Membership\|Attach cleaners and managers" src/app/\(dashboard\)/team/page.tsx`
Expected: returns line range ~1046–1107 (currently).

- [ ] **Step 2: Create `CompanyMembersTab`**

Cut the JSX from lines 1046–1107 (`<section>` with header "Company Membership" and the rows) into `src/components/companies/company-members-tab.tsx`. The component takes one prop: `companyId: Id<"companies"> | null` (when `null`, it shows the global unassigned list).

Hook up:
- `useQuery(api.admin.queries.listCompanyMembers, { companyId })` — if no such query exists, add it (see Step 3). Initial implementation can reuse `companyMembershipRows` data already fetched.
- Reuse `openCompanyEditor`/`assignUserCompanyMembership` actions via props or local mutation hook.

- [ ] **Step 3: Check / add backend query**

Run: `grep -rn "listCompanyMembers\|listCompanyMembership" convex/ | head -5`
If a per-company query already exists, use it. Otherwise the component filters `companyMembershipRows` (the existing flat list) by `companyId`. **Do NOT add a new Convex query in this PR** — keep this frontend-only.

- [ ] **Step 4: Render inside CompaniesHub detail pane**

In `src/components/companies/companies-hub.tsx`, find the detail pane (`companyDetail` block around line 700+). Add a tab strip or section: `Properties` (existing) and `Members` (new). Render `<CompanyMembersTab companyId={companyDetail._id} />` under the Members tab.

- [ ] **Step 5: Delete the Company Membership section from /team**

In `team/page.tsx`, delete the entire `{canManageTeam && groupBy !== "company" ? ( ... ) : null}` block (the section we just extracted). Also remove the `groupBy` shortcut link if it's now dead code.

- [ ] **Step 6: Typecheck + visual smoke test**

Run: `npx tsc --noEmit 2>&1 | grep -E "team/page|companies-hub|company-members-tab" | head -20`
Expected: empty.

`npm run dev` → `/team`: no Company Membership card visible. `/companies` → click any company → see Members tab populated with that company's members.

- [ ] **Step 7: Commit**

```bash
git add src/components/companies/company-members-tab.tsx src/components/companies/companies-hub.tsx src/app/\(dashboard\)/team/page.tsx
git commit -m "feat(team): move company membership management into /companies detail"
```

---

## Task 5: Filter chips on /team

Add 3 quick-filter chips at the top of the user list: `Unassigned (role)`, `Unassigned (company)`, `Inactive 30d`. Persist active chip to localStorage.

**Files:**
- Modify: `src/app/(dashboard)/team/page.tsx`

- [ ] **Step 1: Add state + storage key**

```ts
const TEAM_FILTER_CHIP_KEY = "opscentral.team.filterChip";
type FilterChip = "none" | "unassignedRole" | "unassignedCompany" | "inactive30d";
const [filterChip, setFilterChip] = useState<FilterChip>("none");
// load from localStorage on mount; persist on change
```

- [ ] **Step 2: Compute filtered members**

Wrap the existing `members` array in `useMemo`:
- `unassignedRole`: `member.role === "unassigned"` (also accept `null`/`undefined` defensively)
- `unassignedCompany`: `!member.companyId`
- `inactive30d`: `!member.lastActiveAt || member.lastActiveAt < Date.now() - 30 * 86400_000`

- [ ] **Step 3: Render chip strip**

Place chips below the existing search/role/status filter row. Each chip is a button:
- Off: `border bg-transparent`
- On: `border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]`

Include a count badge next to each chip label, e.g. `Unassigned · 3`.

- [ ] **Step 4: Smoke test**

`npm run dev` → toggle each chip → list narrows → reload → chip persists.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep team/page`
Expected: empty.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(dashboard\)/team/page.tsx
git commit -m "feat(team): add filter chips for unassigned and inactive users"
```

---

## Task 6: Invite user wizard

Add `+ Invite` button on `/team` that opens a 3-step wizard. Existing button likely already exists ("Add Team Member") — we replace its handler.

**Files:**
- Create: `src/components/team/invite-user-wizard.tsx`
- Modify: `src/app/(dashboard)/team/page.tsx`

- [ ] **Step 1: Confirm existing add-button**

Run: `grep -n "Add Team Member\|onAddMember\|InviteMember" src/app/\(dashboard\)/team/page.tsx | head -5`
Note the existing handler — we replace it.

- [ ] **Step 2: Check existing createUser mutation contract**

Run: `sed -n '54,90p' convex/admin/mutations.ts`
Confirm args accept `role?: string` (so `"unassigned"` works). If the mutation enforces a specific union, add `"unassigned"` to the accepted set in this task and call it out in the commit message.

- [ ] **Step 3: Build the wizard component**

```tsx
// src/components/team/invite-user-wizard.tsx
"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Step = "identity" | "role" | "company" | "sent";
type Role = "admin" | "property_ops" | "manager" | "cleaner" | "owner" | "unassigned";

export function InviteUserWizard({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [step, setStep] = useState<Step>("identity");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("unassigned");
  const [companyId, setCompanyId] = useState<string | null>(null);
  const createUser = useMutation(api.admin.mutations.createUser);
  // ... step transitions + final createUser({ name, email, role, companyId }) call
}
```

The third step (company attach) is only shown if `role === "manager" || role === "cleaner"`. It's skippable.

- [ ] **Step 4: Wire button on /team**

Replace the `Add Team Member` button's onClick with `setInviteOpen(true)` and render `<InviteUserWizard open={inviteOpen} onOpenChange={setInviteOpen} />`.

- [ ] **Step 5: Manual test**

`npm run dev` → click `+ Invite` → enter email + name → pick `Cleaner` → company picker shows → pick one → Submit → user appears in list with green check.

Then test the unassigned path: pick role `Unassigned` → skip company step → user appears with amber chip `Unassigned`.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "invite-user-wizard|team/page" | head -20`
Expected: empty.

- [ ] **Step 7: Commit**

```bash
git add src/components/team/invite-user-wizard.tsx src/app/\(dashboard\)/team/page.tsx
git commit -m "feat(team): 3-step invite wizard with optional company attach"
```

---

## Task 7: Cleanup — remove old action sheet, dead state

Now that the drawer fully replaces the action sheet, delete the old code paths.

**Files:**
- Modify: `src/app/(dashboard)/team/page.tsx`

- [ ] **Step 1: Identify dead code**

Run: `grep -n "openMenuForUserId\|action sheet\|memberActionTarget" src/app/\(dashboard\)/team/page.tsx`
Note all the per-row dropdown / action-sheet state and JSX that we bypassed in Task 2.

- [ ] **Step 2: Delete dead code**

Remove:
- `openMenuForUserId` state + its dropdown JSX
- Old `memberActionTarget` modal if no longer triggered
- Any `FEATURE_DRAWER` flag introduced in Task 2

Keep:
- Existing edit-role / edit-profile / edit-company / deactivate modals (still triggered from the drawer)

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit 2>&1 | grep team/page` → empty
Run: `npm run lint -- --max-warnings=0 src/app/\(dashboard\)/team` → clean

- [ ] **Step 4: Visual regression smoke test**

`npm run dev` → click every interactive element on `/team`. Each one must do exactly what it did before, just routed through the drawer.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(dashboard\)/team/page.tsx
git commit -m "refactor(team): remove old per-row action sheet, drawer is the only path"
```

---

## Task 8: Build verification + PR

- [ ] **Step 1: Full build**

```bash
npm run build
```
Expected: exit 0. If `.env.local` is missing, copy from `~/sites/opscentral-admin/.env.local`.

- [ ] **Step 2: Manual UAT checklist on dev server**

`npm run dev` → walk through:
- [ ] `/team` shows: search, role/status filter, density toggle, group toggle, filter chips, slim chip strip, member list. **NO Company Membership card.**
- [ ] Click any row → drawer slides from right with 4 accordion sections.
- [ ] Identity section actions: Change role / Edit profile / Deactivate — all open existing modals.
- [ ] Company section: Change company → opens existing modal.
- [ ] `+ Invite` → 3-step wizard → can complete with role=cleaner+company OR role=unassigned.
- [ ] `/companies` → click company → Members tab visible → can attach/detach members.
- [ ] Unassigned chip on `/team` → narrows list correctly.
- [ ] Refresh → density, groupBy, filterChip all persist.

- [ ] **Step 3: Push branch + open PR**

```bash
git push -u origin task/team-restructure
gh pr create --title "team: split into users + companies, drawer-based detail" --body "$(cat <<'EOF'
## Summary
- Move company-membership management out of /team into /companies/[id] Members tab
- Replace per-row action sheet on /team with right-side drawer (4 accordion sections)
- Add filter chips: Unassigned (role) / Unassigned (company) / Inactive 30d
- 3-step invite wizard with optional company attach

No schema changes. All existing Convex mutations reused.

## Test plan
- [ ] /team renders without Company Membership card
- [ ] Row click opens drawer; all 4 sections work
- [ ] /companies/[id] Members tab works for attach/detach
- [ ] Invite wizard creates user with role + optional company
- [ ] Filter chips persist via localStorage

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Update progress log**

Append final entry to `Docs/2026-06-01-team-page-restructure-progress.md` with PR URL.

```bash
git add Docs/2026-06-01-team-page-restructure-progress.md
git commit -m "docs(team): close out restructure progress log"
git push
```

---

## Out of scope (future PRs)

These were deferred from the prior team-redesign cycle and remain deferred:

| Future PR | Description |
|---|---|
| Bulk actions | Checkbox column, `bulkAssignCompanyMembership` mutation |
| Saved segments | Persisted `teamViews` Convex table |
| Server-side scale | Paginated `teamMetrics`, server-side fuzzy search (gated at >100 users) |
| Multi-tenant tenant filter | Tenant scoping on user/company queries (per ≤200 users-per-tenant target) |

## Open questions to revisit during execution

1. The existing `createUser` mutation's exact role union — confirm in Task 6 Step 2 whether `"unassigned"` is accepted; if not, widen the union in the same commit.
2. Whether `/companies/[id]` is a real route or just a detail pane inside `/companies` (`CompaniesHub`). The plan assumes the latter based on the current `companies-hub.tsx` structure. Adjust Task 4 Step 4 if route-based.
3. `Activity` accordion section currently shows aggregate `summary` data. If users want per-member quality + on-time, that's a future query — placeholder copy is acceptable for v1.
