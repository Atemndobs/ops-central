# Manager Scope — Phase 0 Gap List

**Task:** [PLAN.md](../../../../../opscentral-admin-manager-scope/PLAN.md)
**Reference commit:** `54628ea` — `cleaningJobs.getAll` scoping (canonical pattern)
**Date:** 2026-05-17

---

## R7.1 — Team/Company Model (resolved)

**Answer: join tables, not a single FK.**

| Table | Purpose | Key fields |
|---|---|---|
| `cleaningCompanies` | The "team" / "company" (e.g. Sofia Cleaning — Dallas) | `name`, `city`, `ownerId`, `isActive` |
| `companyMembers` | user ↔ company N:N with role inside the company | `companyId`, `userId`, `role: cleaner\|manager\|owner`, `isActive`, `joinedAt`, `leftAt` |
| `companyProperties` | company ↔ property N:N (which company services which property) | `companyId`, `propertyId`, `isActive`, `unassignedAt` |
| `users.role` | platform role (orthogonal to company role) | `admin \| property_ops \| manager \| cleaner` |

**Manager-scope derivation (canonical):**
1. `companyMembers` where `userId == caller && isActive && leftAt === undefined && role ∈ {manager, owner}` → manager's active company.
2. `companyProperties` where `companyId == manager's company && (isActive !== false) && unassignedAt === undefined` → allowed properties.
3. Jobs allowed → `cleaningJobs` where `propertyId ∈ allowedProperties`. Read via `by_property` index per property (avoids global `by_scheduled` scan).
4. Fail-closed: no active membership OR zero allowed properties → return `[]`.

This is `getCallerJobScopeForListing` in [convex/cleaningJobs/queries.ts:188](../convex/cleaningJobs/queries.ts).

---

## Canonical Helper Status

**Currently inline + duplicated** across 3 files. Extract before reuse.

| File | Functions (private) |
|---|---|
| `convex/cleaningJobs/queries.ts` :152–219 | `isActiveCompanyPropertyAssignment`, `isActiveMembership`, `getLatestActiveCompanyMembership`, `getCallerJobScopeForListing` |
| `convex/cleaningJobs/mutations.ts` :107–145 | `isActiveCompanyPropertyAssignment`, `isActiveMembership`, `getLatestActiveCompanyMembership`, `getActivePropertyCompanyAssignment` |
| `convex/users/queries.ts` :~30–50 | `getLatestActiveMembership` (variant name) |

**Action:** Phase 1 starts by extracting to `convex/lib/companyScope.ts` exporting:
- `getLatestActiveCompanyMembership(ctx, userId)`
- `getActivePropertyCompanyAssignment(ctx, propertyId)`
- `getCallerJobScopeForListing(ctx, user)` → `Set<Id<"properties">> | null`
- `getCallerPropertyScope(ctx, user)` → same shape, reusable for property/job/cleaner listings
- `assertManagerCanAccessProperty(ctx, user, propertyId)` — throws ConvexError on miss

Then rewrite the three call sites to import from the new module.

---

## Surface Audit (R1.1–R1.4, R2, R3)

Legend: ✅ scoped · ⚠️ partial / wrong axis · ❌ unscoped · 🔒 role-only (no company check) · — N/A

### R1.1 — Team page (cleaners list)

| Surface | File | Status | Notes |
|---|---|---|---|
| `users.getCleaners` | [convex/users/queries.ts:241](../convex/users/queries.ts) | ✅ | Filters by company via `getLatestActiveMembership` for non-admin. **Verify "manager appears in own list" requirement** — currently filters to `role === "cleaner"` only (line 267), so manager would NOT appear in their own cleaner list. Clarify with reqs whether manager-as-cleaner is needed. |
| `users.getManagerDashboard` | [convex/users/queries.ts:175](../convex/users/queries.ts) | ⚠️ | Scopes by `assignedManagerId === currentUser._id`, NOT by company. A manager who hasn't been set as `assignedManagerId` on a job won't see it even when it's in their company. **Switch to company-property scope.** Also does `ctx.db.query("cleaningJobs").collect()` — unbounded read. |

### R1.2 — Jobs page

| Surface | File | Status | Notes |
|---|---|---|---|
| `cleaningJobs.getAll` | [convex/cleaningJobs/queries.ts:236](../convex/cleaningJobs/queries.ts) | ✅ | Canonical (commit 54628ea). |
| `cleaningJobs.getById` | [convex/cleaningJobs/queries.ts:333](../convex/cleaningJobs/queries.ts) | ❌ | No actor scope. Direct URL load of another company's job returns the job. **R5 scenario 3 fails today.** |
| `cleaningJobs.getMyJobDetail` | [convex/cleaningJobs/queries.ts:405](../convex/cleaningJobs/queries.ts) | 🔒 | Role gate `admin/manager/property_ops` OR `isAssignedCleaner`. Manager passes the role gate even for out-of-company jobs. **Needs company scope for managers.** |
| `cleaningJobs.getForCleaner` | [convex/cleaningJobs/queries.ts:511](../convex/cleaningJobs/queries.ts) | ❌ | No auth, no scope. Reads entire `cleaningJobs` table. Returns any cleaner's jobs to anyone. |
| `cleaningJobs.getInDateRange` | [convex/cleaningJobs/queries.ts:593](../convex/cleaningJobs/queries.ts) | ❌ | Schedule calendar feed. Returns all jobs across all companies. **Manager Schedule page leaks today.** |
| `cleaningJobs.getReviewQueue` | [convex/cleaningJobs/queries.ts:428](../convex/cleaningJobs/queries.ts) | 🔒 | `assertReviewerRole` only. If managers are reviewers they see all companies' approvals. |
| `cleaningJobs.getReviewJobDetail` | [convex/cleaningJobs/queries.ts:499](../convex/cleaningJobs/queries.ts) | 🔒 | Same as above. |
| `cleaningJobs.getStatusCounts` | [convex/cleaningJobs/queries.ts:1171](../convex/cleaningJobs/queries.ts) | ❌ | Chip counters on jobs page — count across all companies for managers (cosmetic leak + count mismatch vs. scoped list). |
| `cleaningJobs.getSchedulingMetrics` | [convex/cleaningJobs/queries.ts:1248](../convex/cleaningJobs/queries.ts) | ❌ | Dashboard tile counters — same issue. Confirm whether managers are exposed to this query. |
| `cleaningJobs.countByProperty` | [convex/cleaningJobs/queries.ts:528](../convex/cleaningJobs/queries.ts) | 🔒 | Bounded to one property; if `getById` blocks out-of-scope properties, this is reachable only via in-scope IDs. Belt-and-suspenders: still gate. |
| `cleaningJobs.countByCleaner` | [convex/cleaningJobs/queries.ts:539](../convex/cleaningJobs/queries.ts) | ❌ | Same as `getForCleaner`. |
| `cleaningJobs.assign` (mutation) | [convex/cleaningJobs/mutations.ts:1135](../convex/cleaningJobs/mutations.ts) | ✅ | Both property→company and cleaner→company checks present. |
| `cleaningJobs.create` (mutation) | [convex/cleaningJobs/mutations.ts:488](../convex/cleaningJobs/mutations.ts) | ❌ | No role guard, no scope guard. Anyone authenticated can create a job on any property. |
| `cleaningJobs.start / submitForApproval / complete / reopenForRework / excuseCleanerSession` | mutations.ts | partial | Most enforce `requirePrivilegedRole` + cleaner-self checks. Confirm each rejects manager acting outside their company. |

### R1.3 — Properties page + assignment dropdowns

| Surface | File | Status | Notes |
|---|---|---|---|
| `properties.list` | [convex/properties/queries.ts:176](../convex/properties/queries.ts) | ❌ | Returns all active properties to any caller. |
| `properties.getAll` | [convex/properties/queries.ts:258](../convex/properties/queries.ts) | ❌ | Same. |
| `properties.search` | [convex/properties/queries.ts:216](../convex/properties/queries.ts) | ❌ | Search returns cross-company hits. |
| `properties.getById` | [convex/properties/queries.ts:200](../convex/properties/queries.ts) | ❌ | Direct URL load not blocked. |
| `properties.getMyAccessibleProperties` | [convex/properties/queries.ts:290](../convex/properties/queries.ts) | ⚠️ | Explicitly treats manager same as admin/property_ops — returns all properties. Should scope to `companyProperties` for managers. |
| `cleaningJobs.getAssignableCleanersByProperty` | [convex/cleaningJobs/queries.ts:614](../convex/cleaningJobs/queries.ts) | ✅ | Inline manager scope at lines 627–702. |
| `cleaningJobs.getAssignable` | [convex/cleaningJobs/queries.ts:563](../convex/cleaningJobs/queries.ts) | ? | Re-audit — not inspected in this pass. |
| `properties.create / update / softDelete` | [convex/properties/mutations.ts](../convex/properties/mutations.ts) | ? | Likely admin/ops only by design; confirm with reqs whether manager edits are allowed for their own properties. |

### R1.4 — Manager-as-cleaner flow

| Surface | Status | Notes |
|---|---|---|
| `cleaningJobs.getMyAssigned` | ✅ | Reads via `userJobAssignments` reverse-index by caller's `userId`. Works regardless of platform role — manager assigned to a job sees it. |
| `cleaningJobs.start / submitForApproval / complete` mutations on own jobs | likely ✅ | Use `assignedCleanerIds.includes(actor._id)` checks. Confirm explicitly. |
| Cleaner PWA route guards (`/cleaner/...`) | ? | Verify route-level guards in `src/middleware.ts` or `app/(cleaner)/layout.tsx` don't reject `role === "manager"`. |

### R2 — Cross-app reads (mobile cleaner app)

Mobile is frozen but shares the Convex backend. Confirm no manager-facing path lives only in mobile. Per [CLAUDE.md], OpsCentral is the manager surface; mobile is cleaner-only — should be a non-issue, but call it out.

### R3 — Server-side defense in depth

All ❌ and 🔒 rows above are R3 violations. **Server must enforce; UI must not be the only fence.** The Phase 1 work order:
1. Extract `convex/lib/companyScope.ts` (refactor, no behavior change).
2. Patch each ❌/🔒 row, smallest blast radius first: `getById` queries → list queries → mutations.
3. For each, add a test/scripted check that calls as Manager B and asserts Manager A's resource is invisible / rejected.

---

## R4 — Capability audit (deferred to Phase 3)

To be filled in by walking Manager A through every R4 item against a scoped build.

---

## R5 — Acceptance Scenarios (status)

| # | Scenario | Today |
|---|---|---|
| 1 | Manager A sees only Sofia cleaners + jobs | ⚠️ jobs ✅, properties ❌, schedule ❌, dashboards ⚠️ |
| 2 | Manager B disjoint view | same gaps as #1 |
| 3 | Manager A loads Manager B's job by direct URL | ❌ `getById` returns it |
| 4 | Manager A assigns a job → cleaner sees it | ✅ assign mutation is scoped |
| 5 | Manager A's own cleaner dashboard works | likely ✅ — verify in Phase 2 |
| 6 | Convex logs show no cross-company query success | ❌ — pending R3 patches |

---

## Decisions (resolved 2026-05-17)

- **R7.4 — Approval rights:** **ops + admin only.** Managers do NOT approve. `getReviewQueue` and `getReviewJobDetail` must drop `manager` from the allowed-role gate (change `assertReviewerRole` to admit only `admin` / `property_ops`). No company-scope work needed — managers are rejected outright.
- **R1.1 — Team list contents:** Show users with `users.role === "cleaner"` only. **Exception:** if a manager also has a `companyMembers` row with `role === "cleaner"` in the same company (i.e. a cleaner-manager hybrid), include them. Current `getCleaners` filters by `users.role === "cleaner"` via the `by_role` index — does NOT pick up cleaner-manager hybrids whose platform role is `"manager"`. **Action:** rewrite `getCleaners` to drive off `companyMembers` (role=cleaner, isActive) for the caller's company instead of the platform-role index. That naturally includes hybrids and is also more correct.
- **`cleaningJobs.create` policy:** **Admin / property_ops only.** Managers and cleaners cannot create. Jobs come from Hospitable webhook automatically; manual creation is an ops escape hatch. **Action:** add `requireRole(ctx, ["admin", "property_ops"])` at the top of the `create` mutation.

## Deferred

- **R5 Scenario 2 ("Manager B disjoint view")** — Skipped for now. Only Sofia Cleaning exists today; second-company acceptance happens manually post-launch when a real second company is onboarded. Scope correctness is still proved by Scenarios 1, 3, 4, 5, 6 against Sofia + a synthetic "no-membership" user (returns `[]` per fail-closed). The unit-level Convex check in Phase 1 will exercise the scope helper directly with two synthetic `cleaningCompanies` rows in-test, so the code path is covered even without persistent seed data.
