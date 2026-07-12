# Worktree Handoff

## Task
TASK-OPS-SCOPE-001

## Type
bugfix + role-scoping

## Branch
task/ops-scope-and-settings-fix

## Worktree
~/sites/opscentral-admin-ops-scope

## Base
origin/main @ 717b406

## Status
ready-for-integration

## What changed
Fixes a reported bug and rescopes the `property_ops` (ops) role's nav/route
access per business direction — ops handles day-to-day operations, not user
management or financial reporting.

**Bug fix:** `property_ops` was missing from `ROUTE_ACCESS` in
`src/lib/auth.ts` entirely for `/settings` — ops literally could not reach
the Settings page. Added.

**Removed from ops** (`src/lib/auth.ts` + `src/components/layout/navigation.ts`):
- `/reports` (and everything under it — Monthly Close, Property Costs — via
  the same route prefix + nav-role removal). Financial/reporting is not an
  ops responsibility.
- `/team` (user management) — kept for `admin` and `manager`.
- `/admin/owner-overview` (property-owner user management) — admin only now.
  Note: this was previously in ops's nav-item roles but NOT in their
  `ROUTE_ACCESS`, so the link was already silently broken for ops before this
  change (part of the "not scoped correctly" bug report) — now consistently
  removed from both.

**Kept for ops** (explicit, per direction): `/companies` — no change.

**Settings simplified for ops** (`src/components/settings/settings-page-client.tsx`):
Settings previously had zero role-gating internally — anyone who could reach
the page saw all 5 tabs and all Integrations cards. Added client-side role
detection (same pattern already used elsewhere in this file) and hid, for
non-admins:
- The "Team" tab (`TeamSettingsPanel` — shows a user-management role-access
  matrix and links to `/team`).
- The "Service usage & cost" card within Integrations (`UsageDashboardCard`
  — billing/spend dashboard). Its backing Convex queries already enforce
  `requireAdmin` server-side per the page's own docblock, so this is UI
  hardening on top of an existing data-layer guard, not the only protection.

Ops still sees: General, Scheduling, Notifications, and Integrations minus
the cost card (Feature flags, AI provider, Storage provider, Role colors,
Rework deadline, Connected services placeholder) — none of these are
financial or user-management.

**Renamed** (`src/messages/en.json`, `es.json`): `common.incidents` label
"Incidents" → "Incidents & Refills" ("Incidentes" → "Incidentes y
Reposiciones"). Per direction, this is a pure label change — no new
supply/refill-reporting functionality was requested or built. Same key
drives the sidebar nav item and (wherever else `common.incidents` is used
via `useTranslations`) — did not find or touch any other hardcoded
"Incidents" string.

## What main should test
1. `npm run lint` — clean on all 3 touched source files (0 errors, 0
   warnings). Two pre-existing errors elsewhere (`header.tsx`
   set-state-in-effect, `dashboard-client.tsx` exhaustive-deps warnings)
   confirmed present on `main` independently — not touched by this branch.
2. `npx tsc --noEmit` — identical error count/content to `main` (100 lines,
   all pre-existing `appSettings`/generated-types staleness, unrelated to
   this change — confirmed via diff against main's own tsc output).
3. `npm run build` — webpack compile step ("Compiled successfully") passes;
   fails at the same pre-existing type-check point `main` itself already
   fails at (see "Known unrelated issue" below). Not caused by this branch.
4. Manual: log in as a `property_ops` user and confirm:
   - Settings is now reachable and shows General/Scheduling/Notifications/
     Integrations tabs, no Team tab, no cost dashboard card.
   - Reports, Monthly Close, Property Costs, Team, and Owner Overview no
     longer appear in the sidebar nor the top-nav "Reports" link.
   - Companies is still visible/functional.
   - Incidents nav label reads "Incidents & Refills".
5. Manual: confirm `admin` and `manager` are unaffected (admin sees
   everything as before; manager still has `/team` per existing behavior,
   unchanged by this PR).

## Known unrelated issue (found during verification, not caused by this branch)
`npm run build`'s TypeScript step currently fails on `main` itself —
`convex/appSettings.ts` references the `appSettings` table, which isn't in
the committed `convex/_generated/dataModel.d.ts`. This is a codegen-staleness
issue (needs `npx convex dev --once` or `deploy` from the main session,
forbidden from a worktree) unrelated to ops-scoping. Confirmed via a byte-diff
of `tsc --noEmit` output between this branch and `main` — identical. Flagging
so it isn't mistaken for something this PR introduced; may be worth a
separate main-session codegen pass regardless of this PR's merge timing.

## Schema impact
none

## Convex impact
none — pure frontend role/nav/label changes.

## Commands main should run
- npm run lint
- npx tsc --noEmit (compare against main's own output if it looks alarming — see above)
- npm run build (same caveat)
- Manual role-based smoke test per "What main should test" above

## Known risks
- Low. No schema/backend changes. Worst case of a scoping mistake is an ops
  user losing/gaining visibility into a nav item — reversible via `git revert`.
- `/team` removal for ops was the one judgment call requiring interpretation
  (user said "ops should not handle user management" without specifying
  whether that meant the whole Team page or just parts of it). Chose to
  remove the whole nav item + route access since: (a) the Settings "Team" tab
  it's most closely associated with is literally titled a user-management
  role-access matrix, (b) nothing else in the app route-navigates to `/team`
  (confirmed via grep — Companies Hub's user-attach flow uses Convex queries
  directly, not `/team` navigation), so ops loses no other in-context
  workflow. If ops actually needs read-only team-roster visibility (e.g. to
  see who's available before assigning a job via Schedule/Jobs, which remain
  accessible), that's a distinct, narrower ask worth a follow-up if it comes
  up in practice.

## Rollback plan
`git revert <merge sha>` — no data involved, pure UI/route-access config.
