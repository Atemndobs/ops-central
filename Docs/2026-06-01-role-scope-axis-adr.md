# ADR — Role × Scope as Two Axes (data-driven)

**Status:** Proposed
**Date:** 2026-06-01
**Authors:** Atem + Claude
**Supersedes:** none
**Related:** [2026-06-01-team-page-restructure-plan.md](2026-06-01-team-page-restructure-plan.md)

---

## Context

The opscentral admin currently treats role as a single axis (`cleaner | manager | property_ops | admin | owner`). The Team Management drawer hard-codes the assumption that **every role needs company + property scoping**, which produces false alarms like *"No company assigned · Not visible to any manager"* on a Property Ops user — when in fact Property Ops is tenant-wide by design and should have no scoping affordance at all.

Role definitions today are scattered across the codebase as duplicated `v.literal(...)` unions:

| Location | Role union |
|---|---|
| `convex/schema.ts:18-24` (`users.role`) | `cleaner \| manager \| property_ops \| admin \| owner` |
| `convex/schema.ts:74-78` (`companyMembers.role`) | `cleaner \| manager \| owner` (vendor-internal) |
| `convex/schema.ts:1523-1526` (notification target?) | `admin \| property_ops \| manager \| cleaner` |
| `src/app/api/team-members/route.ts:9-16` (createPayloadSchema) | `cleaner \| manager \| property_ops \| admin` |
| `src/app/(dashboard)/team/page.tsx:28` (`UserRole`) | `cleaner \| manager \| property_ops \| admin \| owner` |
| `convex/lib/auth.ts` (`requireRole` callsites — at least 14) | varies per callsite |

Each union encodes role identity but **never scope**. The UI has to infer scope from the role string, which leaks role taxonomy into every consumer.

---

## Decision

Introduce a single source of truth for **role definitions**, where each role carries a `scope` value and the scoping requirements it needs. The UI and the backend both read this definition; no consumer hard-codes role behavior.

### Axes

1. **Role** — permission verbs (what they can do). String key, stable.
2. **Scope** — which slice of data those permissions act on. Four values:
   - `tenant` — portfolio-wide; sees everything in the tenant. *Admin, Property Ops, Ops.*
   - `company` — vendor-side; sees what their cleaning company controls. *Vendor Manager.*
   - `entity` — single-record; sees one specific thing. *Cleaner (their jobs).*
   - `ownership` — per-property stake. *Owner.*

### Data shape

```ts
// convex/lib/roles.ts — single source of truth, imported by schema + server + UI
export const ROLE_DEFINITIONS = {
  admin: {
    key: "admin",
    label: "Admin",
    scope: "tenant",
    requiresCompany: false,
    requiresProperty: false,
    canBecomeCompanyMember: false,
    canBecomeOwner: false,
    description: "Full access to everything in the tenant.",
  },
  property_ops: {
    key: "property_ops",
    label: "Property Ops",
    scope: "tenant",
    requiresCompany: false,
    requiresProperty: false,
    canBecomeCompanyMember: false,
    canBecomeOwner: false,
    description: "Internal J&A role; portfolio-wide oversight, no scoping.",
  },
  manager: {
    key: "manager",
    label: "Vendor Manager",
    scope: "company",
    requiresCompany: true,            // ← real alarm if missing
    requiresProperty: false,
    canBecomeCompanyMember: true,
    canBecomeOwner: false,
    description: "Cleaning-company manager; dispatches their company's cleaners.",
  },
  cleaner: {
    key: "cleaner",
    label: "Cleaner",
    scope: "entity",
    requiresCompany: true,            // ← real alarm if missing
    requiresProperty: false,           // properties optional; jobs are the unit of work
    canBecomeCompanyMember: true,
    canBecomeOwner: false,
    description: "Field worker; sees only the jobs assigned to them.",
  },
  owner: {
    key: "owner",
    label: "Owner",
    scope: "ownership",
    requiresCompany: false,
    requiresProperty: false,           // ownership rows are separate, not enforced as "assigned property"
    canBecomeCompanyMember: false,
    canBecomeOwner: true,              // implied — they own ownership rows
    description: "Property owner; sees properties they hold stake in.",
  },
} as const satisfies Record<string, RoleDefinition>;

export type RoleKey = keyof typeof ROLE_DEFINITIONS;
export type RoleScope = "tenant" | "company" | "entity" | "ownership";
export type RoleDefinition = {
  key: string;
  label: string;
  scope: RoleScope;
  requiresCompany: boolean;
  requiresProperty: boolean;
  canBecomeCompanyMember: boolean;
  canBecomeOwner: boolean;
  description: string;
};

// Helpers
export const ROLE_KEYS = Object.keys(ROLE_DEFINITIONS) as RoleKey[];
export const ROLE_VALIDATOR_UNION = ROLE_KEYS.map((k) => v.literal(k));
export function getRoleDefinition(role: string): RoleDefinition | undefined {
  return (ROLE_DEFINITIONS as Record<string, RoleDefinition>)[role];
}
export function isTenantScoped(role: string): boolean {
  return getRoleDefinition(role)?.scope === "tenant";
}
```

### Where this gets imported

| Consumer | What it replaces |
|---|---|
| `convex/schema.ts` (`users.role`) | The inline `v.union(v.literal(...), ...)` → `v.union(...ROLE_VALIDATOR_UNION)` |
| `convex/lib/auth.ts` (`requireRole`) | Type-narrowed param: `requireRole(ctx, roles: RoleKey[])` |
| `src/app/api/team-members/route.ts` (createPayloadSchema) | `z.enum(ROLE_KEYS)` instead of hand-written union |
| `src/app/(dashboard)/team/page.tsx` | `type UserRole = RoleKey` + drawer reads `getRoleDefinition(role).scope` |
| `src/components/team/team-detail-drawer.tsx` | Reads `requiresCompany` / `requiresProperty` to decide which sections to render |

### Why TS-constants, not a Convex `roleDefinitions` table

| Option | Pros | Cons |
|---|---|---|
| **TS constants (chosen)** | Type-safe at compile time; the IDE knows every role inline; zero migration cost; pure refactor | Roles can't be added by tenants at runtime |
| Convex table | Tenant-specific roles for multi-tenant future; admin can mint a custom role | Loses compile-time type safety; UI has to handle "unknown role"; needs cache invalidation; today's roles aren't tenant-specific |

**Decision:** TS constants now. Revisit when a real customer requests custom roles. The TS file is the *contract*; a future tenant-roles table can layer on top by merging tenant overrides over the base map.

---

## UI rule (the actual fix the user spotted)

The drawer renders sections by `roleDef.scope`:

```ts
const def = getRoleDefinition(member.role);
const showCompanySection  = def?.requiresCompany ?? false;
const showPropertySection = def?.requiresProperty ?? false;
const tenantScoped        = def?.scope === "tenant";
```

| Scope | Sections shown in drawer |
|---|---|
| `tenant` | Identity · Change role · neutral chip **"Portfolio-wide · no scoping required"** · *(optional)* Portfolio reach |
| `company` | Identity · Change role · Company membership (empty = real amber warning) |
| `entity` | Identity · Change role · Company (employer) · Property assignment |
| `ownership` | Identity · Change role · Owned properties + stake % per row |

The amber alarm *"No company assigned · Not visible to any manager"* only fires when `def.requiresCompany === true && !member.companyId`. For Property Ops it never fires.

---

## Migration plan (no schema break)

The literal strings in `users.role` are unchanged — only how we *describe* them. Phasing:

### Phase 1 — Define the contract (1 PR, no behavior change)
- Create `convex/lib/roles.ts` with `ROLE_DEFINITIONS` + helpers
- Re-export from `src/lib/roles.ts` (or import from `@convex/lib/roles` directly in the web app) so both ends share it
- Backend: nothing else changes — `users.role` still validates as the same union

### Phase 2 — UI consumes scope (1 PR, fixes the bug)
- `team-detail-drawer.tsx` and `team/page.tsx` import `getRoleDefinition`
- Drawer hides company/property sections for tenant-scoped roles
- Amber alarm only fires when `requiresCompany && !companyId`
- *This is the PR that fixes the screenshot bug.*

### Phase 3 — Replace hand-written unions (1 PR, pure refactor)
- `convex/schema.ts` swaps `v.union(v.literal("cleaner"), ...)` → `v.union(...ROLE_VALIDATOR_UNION)` for `users.role`
- `src/app/api/team-members/route.ts` swaps z.union → `z.enum(ROLE_KEYS)`
- `requireRole` callsites narrow to `RoleKey[]` — TS surfaces any stale uses

### Phase 4 — Demotion warnings (optional, 1 PR)
- When admin changes role in the editor, compare old/new `requiresCompany` / `requiresProperty`:
  - Demoting Property Ops → Cleaner: warn *"This user will need a company assignment"*
  - Demoting Manager → Cleaner: no-op (both need company)
  - Promoting Cleaner → Property Ops: no warning, but optionally auto-clear company membership
- Implemented in the `Change role` confirm dialog

---

## Out of scope for this ADR

- **Owner role plumbing.** Owners have their own portal and their own ownership table; integrating them into the drawer is a separate UX question. This ADR just declares `scope: "ownership"`; the drawer's ownership section is a placeholder for now.
- **Multi-tenant role customization.** Deferred per the TS-constants tradeoff above.
- **Permission verbs themselves.** This ADR is about *scope*, not about what an Admin can do that Property Ops can't. The `requireRole` array stays the source of truth for permission verbs.
- **Cleaner-app + Owner-portal.** Both have their own drawers/menus that already render correctly for their single role; this change is opscentral-admin only.

---

## Consequences

**Good**
- Bug is fixed at the model layer, not patched per-component.
- Adding a role is now a one-file change (add an entry to `ROLE_DEFINITIONS`); every consumer picks it up via TS.
- The drawer (and every future per-user surface) stops asking "what does this role need?" because the role tells it.
- `requireRole` callsites become type-narrowable to `RoleKey[]` — typos fail at build.

**Bad / risky**
- One more layer of indirection: a contributor reading the schema has to follow the import to see the role list. Mitigation: keep the file small and well-commented.
- The `users.role` field type is unchanged (still a string union), so the migration is safe — but if we ever try to *remove* a role from `ROLE_DEFINITIONS` without first migrating user rows off it, schema validation will fail at write time. Add a CI check that all `users.role` values exist in `ROLE_KEYS`.

---

## Open questions

1. **`companyMembers.role`** is a separate union (`cleaner | manager | owner`) used vendor-internally. Should it pull from `ROLE_DEFINITIONS` too, or stay as a vendor-domain mini-taxonomy? *Recommendation: keep separate — vendor's internal hierarchy is a different concept than platform role.*
2. Where does `ROLE_DEFINITIONS` physically live so both Convex and Next can import it? *Recommendation: `convex/lib/roles.ts` (Convex side), re-exported from `src/lib/roles.ts` to keep import paths clean on the web app.*
3. Should `requireRole` accept a scope filter (e.g. `requireRole(ctx, { scope: "tenant" })`) as a shorthand? *Out of scope for v1 — explicit role lists are clearer; revisit if we end up writing `requireRole(ctx, ["admin", "property_ops"])` a dozen more times.*

---

## Next step

If approved, ship **Phase 1 + Phase 2 in one PR** — that's the minimum to fix the screenshot bug end-to-end. Phase 3 (refactor existing unions) and Phase 4 (demotion warnings) ship separately.
