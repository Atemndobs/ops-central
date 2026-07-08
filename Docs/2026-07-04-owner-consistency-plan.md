# Owner Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `propertyOwners` the single source of truth for "who is an owner and what do they own" across the Team page, the admin Owner Overview, and Monthly Close statement views — so the three surfaces can never silently disagree.

**Architecture:** Extract the "active ownership" rules (`effectiveTo === undefined`, company-else-name client label) into pure shared helpers in `convex/lib/`. The Team page and Owner Overview then *surface* role↔ownership drift instead of hiding it (a role=owner user with zero stakes gets a visible warning). Monthly Close views gain an optional `ownerUserId` binding: a bound view derives its client name and property list **live** from `users` + `propertyOwners` at read time, so statements always reflect current ownership.

**Tech Stack:** Next.js 16 (App Router, client components), Convex (queries/mutations in `convex/`), Tailwind CSS v4, `node --test` for pure-logic unit tests.

## Background — the three surfaces today (read this first)

| Surface | File(s) | How it decides "owner" today |
|---|---|---|
| Team page | [src/app/(dashboard)/team/page.tsx](../src/app/(dashboard)/team/page.tsx) fed by `getTeamMetrics` in [convex/admin/queries.ts:192-368](../convex/admin/queries.ts) | `users.role === "owner"` — a label only; implies nothing about properties |
| Owner Overview | [src/app/(dashboard)/admin/owner-overview/page.tsx](../src/app/(dashboard)/admin/owner-overview/page.tsx) fed by `listOwners` in [convex/admin/ownerOverview.ts:64-130](../convex/admin/ownerOverview.ts) | Users holding ≥1 `propertyOwners` row with `effectiveTo === undefined` |
| Monthly Close views | [src/admin/tools/monthly-close/App.tsx](../src/admin/tools/monthly-close/App.tsx), [ViewManager.tsx](../src/admin/tools/monthly-close/ViewManager.tsx), [convex/strCosts/views.ts](../convex/strCosts/views.ts), schema table `portfolioViews` at [convex/schema.ts:1882-1888](../convex/schema.ts) | Free-text `clientName` + a snapshot `propertyIds[]` array; completely independent of ownership |

The bug this plan fixes: a user (Tataw John) has `role="owner"` but zero `propertyOwners` rows, so he shows on the Team page, is invisible in Owner Overview, and can't be picked as a statement client — with no indication anywhere of *why*.

## Global Constraints

- **Work in a worktree, never the main checkout.** Main checkout `apps-ja/opscentral-admin/` stays on `main` untouched. See Task 1 Step 1.
- **NEVER run** `npx convex deploy`, `npx convex dev`, `npx convex dev --once`, or `npx convex codegen` from the worktree. The main session deploys after merge. (`.harness/convex.md`)
- **Schema impact is `backward-compatible`** (one new optional field, no index changes, no backfill) — eligible for a single combined PR per `.harness/convex.md` "Exception".
- **TypeScript strict, no `any`** without justification. All new files `.ts`/`.tsx`.
- **Tailwind v4 gotcha:** this repo has no `@theme` block, so shadcn-style named utilities (`bg-muted`, `text-muted-foreground`) generate **no CSS**. For new markup use arbitrary-value syntax with CSS variables — `text-[var(--muted-foreground)]`, `bg-[var(--card)]`. Core palette utilities (`text-amber-600`, `border-amber-500/30`) work normally.
- **Toast API:** `showToast(message, variant)` where variant is only `"success" | "error"` ([src/components/ui/toast-provider.tsx:5](../src/components/ui/toast-provider.tsx)).
- **Tests:** `npm test` runs `node --test` (Node v22.22 — native TypeScript type-stripping, so `.test.mjs` files may import `.ts` modules **with an explicit `.ts` extension**). Existing example: [tests/mutation-loop-guard.test.mjs](../tests/mutation-loop-guard.test.mjs).
- **Conventional commits** (`feat(scope): …`, `refactor(scope): …`). Commit after every green task.
- Business logic lives in Convex, not in React components (repo rule #1).

---

### Task 1: Worktree setup + pure ownership helpers

**Files:**
- Create: `convex/lib/ownership.ts`
- Test: `tests/ownership-helpers.test.mjs`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces (used by Tasks 2, 3, 5):
  - `filterActiveOwnerships<T extends OwnershipLike>(rows: T[]): T[]`
  - `groupActiveByUser<T extends OwnershipLike>(rows: T[]): Map<string, T[]>`
  - `resolveOwnerClient(user: ClientNameSource): string`
  - `interface OwnershipLike { userId: string; propertyId: string; effectiveTo?: number }`
  - `interface ClientNameSource { name?: string | null; email?: string | null; company?: string | null }`

- [ ] **Step 1: Create the worktree (one per task — hard user rule)**

```bash
cd /Users/atem/sites/jnabusiness_solutions/apps-ja/opscentral-admin
git fetch origin
git worktree add -b task/owner-consistency ~/sites/opscentral-admin-owner-consistency origin/main
cd ~/sites/opscentral-admin-owner-consistency
npm install
```

All subsequent steps run inside `~/sites/opscentral-admin-owner-consistency`.

- [ ] **Step 2: Write the failing test**

Create `tests/ownership-helpers.test.mjs`:

```js
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  filterActiveOwnerships,
  groupActiveByUser,
  resolveOwnerClient,
} from "../convex/lib/ownership.ts";

describe("filterActiveOwnerships", () => {
  it("keeps only rows with effectiveTo === undefined", () => {
    const rows = [
      { userId: "u1", propertyId: "p1" },
      { userId: "u1", propertyId: "p2", effectiveTo: 123 },
    ];
    assert.deepStrictEqual(filterActiveOwnerships(rows), [rows[0]]);
  });
});

describe("groupActiveByUser", () => {
  it("groups active rows by userId and drops closed rows", () => {
    const rows = [
      { userId: "u1", propertyId: "p1" },
      { userId: "u1", propertyId: "p2" },
      { userId: "u2", propertyId: "p3", effectiveTo: 1 },
    ];
    const map = groupActiveByUser(rows);
    assert.strictEqual(map.get("u1").length, 2);
    assert.strictEqual(map.has("u2"), false);
  });
});

describe("resolveOwnerClient", () => {
  it("prefers trimmed company, then name, then email, then placeholder", () => {
    assert.strictEqual(
      resolveOwnerClient({ company: " Acme LLC ", name: "Bob" }),
      "Acme LLC",
    );
    assert.strictEqual(resolveOwnerClient({ company: "  ", name: "Bob" }), "Bob");
    assert.strictEqual(resolveOwnerClient({ email: "b@x.com" }), "b@x.com");
    assert.strictEqual(resolveOwnerClient({}), "(unnamed owner)");
  });
});
```

- [ ] **Step 3: Run the test — verify it fails**

Run: `node --test tests/ownership-helpers.test.mjs`
Expected: FAIL — `Cannot find module … convex/lib/ownership.ts`

- [ ] **Step 4: Implement the helpers**

Create `convex/lib/ownership.ts`:

```ts
// Pure helpers over `propertyOwners` rows and owner users. Shared by
// admin/queries.getTeamMetrics, admin/ownerOverview.listOwners and
// strCosts/views.* so every surface answers "who owns what" and "what
// prints on a statement" identically.
//
// An ownership row is ACTIVE iff `effectiveTo === undefined` (closed rows
// keep their close timestamp — the table is append-only / time-versioned).

export interface OwnershipLike {
  userId: string;
  propertyId: string;
  effectiveTo?: number;
}

export function filterActiveOwnerships<T extends OwnershipLike>(rows: T[]): T[] {
  return rows.filter((o) => o.effectiveTo === undefined);
}

export function groupActiveByUser<T extends OwnershipLike>(
  rows: T[],
): Map<string, T[]> {
  const byUser = new Map<string, T[]>();
  for (const o of filterActiveOwnerships(rows)) {
    const list = byUser.get(o.userId) ?? [];
    list.push(o);
    byUser.set(o.userId, list);
  }
  return byUser;
}

export interface ClientNameSource {
  name?: string | null;
  email?: string | null;
  company?: string | null;
}

/** What prints on a statement: company if set (trimmed), else name, else email. */
export function resolveOwnerClient(user: ClientNameSource): string {
  const company = user.company?.trim();
  if (company) return company;
  return user.name ?? user.email ?? "(unnamed owner)";
}
```

- [ ] **Step 5: Run the test — verify it passes**

Run: `node --test tests/ownership-helpers.test.mjs`
Expected: PASS (3 subtests). Also run `npm test` — the existing mutation-loop-guard suite must stay green.

- [ ] **Step 6: Commit**

```bash
git add convex/lib/ownership.ts tests/ownership-helpers.test.mjs
git commit -m "feat(owners): shared pure helpers for active ownership + client label"
```

---

### Task 2: Team page — make role↔ownership drift visible

**Files:**
- Modify: `convex/admin/queries.ts` (inside `getTeamMetrics`, ~lines 192-360)
- Modify: `src/app/(dashboard)/team/page.tsx` (3 render sites: ~1157, ~1248, ~1329)

**Interfaces:**
- Consumes: `groupActiveByUser` from `convex/lib/ownership` (Task 1).
- Produces: each `getTeamMetrics` member row gains `ownedPropertyCount: number | null` (a number for `role === "owner"` users, `null` for everyone else). Convex return types flow to the page automatically via `_generated/api.d.ts` — **no codegen needed**.

- [ ] **Step 1: Extend `getTeamMetrics`**

In `convex/admin/queries.ts`, add the import at the top with the other relative imports:

```ts
import { groupActiveByUser } from "../lib/ownership";
```

Find this block (~line 192):

```ts
    const [users, jobs, memberships] = await Promise.all([
      ctx.db.query("users").collect(),
      ctx.db.query("cleaningJobs").collect(),
      ctx.db.query("companyMembers").collect(),
    ]);
```

Replace with:

```ts
    const [users, jobs, memberships, ownerships] = await Promise.all([
      ctx.db.query("users").collect(),
      ctx.db.query("cleaningJobs").collect(),
      ctx.db.query("companyMembers").collect(),
      ctx.db.query("propertyOwners").collect(),
    ]);
    const stakesByUser = groupActiveByUser(ownerships);
```

Then in the member-row object literal (~line 341, the `return {` inside `visibleUsers.map`), after the line `role: user.role,` add:

```ts
          // Owners only: how many distinct properties they hold an ACTIVE
          // stake in. 0 = role/ownership drift (flagged in the UI).
          ownedPropertyCount:
            user.role === "owner"
              ? new Set(
                  (stakesByUser.get(user._id) ?? []).map((o) => o.propertyId),
                ).size
              : null,
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit 2>&1 | head -20` (or `npm run build` if faster feedback isn't needed)
Expected: no new errors from `convex/admin/queries.ts`.

- [ ] **Step 3: Add the warning badge at the three role render sites in `src/app/(dashboard)/team/page.tsx`**

Site 1 — card layout (~line 1156). Find:

```tsx
                        <p className="mt-1 text-[11px] uppercase tracking-wider text-[var(--muted-foreground)]">
                          {formatRoleLabel(member.role)}
                        </p>
```

Replace with:

```tsx
                        <p className="mt-1 text-[11px] uppercase tracking-wider text-[var(--muted-foreground)]">
                          {formatRoleLabel(member.role)}
                          {member.role === "owner" && member.ownedPropertyCount === 0 ? (
                            <span className="ml-2 font-semibold text-amber-600">
                              No properties linked
                            </span>
                          ) : null}
                        </p>
```

Site 2 — compact list (~line 1247). Find:

```tsx
                        <p className="mt-0.5 text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
                          {formatRoleLabel(member.role)} · {member.availability}
                        </p>
```

Replace with:

```tsx
                        <p className="mt-0.5 text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
                          {formatRoleLabel(member.role)} · {member.availability}
                          {member.role === "owner" && member.ownedPropertyCount === 0 ? (
                            <span className="ml-2 font-semibold text-amber-600">
                              No properties linked
                            </span>
                          ) : null}
                        </p>
```

Site 3 — table cell (~line 1328). Find:

```tsx
                      <td className={`${cellPad} text-[var(--muted-foreground)]`}>
                        {formatRoleLabel(member.role)}
                      </td>
```

Replace with:

```tsx
                      <td className={`${cellPad} text-[var(--muted-foreground)]`}>
                        {formatRoleLabel(member.role)}
                        {member.role === "owner" && member.ownedPropertyCount === 0 ? (
                          <span className="ml-2 text-[11px] font-semibold uppercase tracking-wider text-amber-600">
                            No properties linked
                          </span>
                        ) : null}
                      </td>
```

Note: the page has no local member interface — rows are typed as `(typeof members)[number]` straight from the query, so `member.ownedPropertyCount` type-checks with no further edits.

- [ ] **Step 4: Verify lint + build + tests**

Run: `npm run lint && npm test && npm run build`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add convex/admin/queries.ts "src/app/(dashboard)/team/page.tsx"
git commit -m "feat(team): flag owner-role users with zero linked properties"
```

---

### Task 3: Owner Overview — list unlinked owner-role users instead of hiding them

**Files:**
- Modify: `convex/admin/ownerOverview.ts` (helper ~line 36, `listOwners` ~lines 64-130)
- Modify: `src/app/(dashboard)/admin/owner-overview/page.tsx`

**Interfaces:**
- Consumes: `filterActiveOwnerships` from `convex/lib/ownership` (Task 1).
- Produces: every `listOwners` row gains `unlinked: boolean`. Linked rows: `unlinked: false`. New rows for role=owner users with zero active stakes: `unlinked: true, propertyCount: 0, lastStatement: null, draftsPending: 0`.

- [ ] **Step 1: Refactor `loadActiveOwnerships` to the shared helper (DRY)**

In `convex/admin/ownerOverview.ts`, add to the imports:

```ts
import { filterActiveOwnerships } from "../lib/ownership";
```

Find (~line 36):

```ts
async function loadActiveOwnerships(
  ctx: QueryCtx,
): Promise<Doc<"propertyOwners">[]> {
  const all = await ctx.db.query("propertyOwners").collect();
  return all.filter((o) => o.effectiveTo === undefined);
}
```

Replace with:

```ts
async function loadActiveOwnerships(
  ctx: QueryCtx,
): Promise<Doc<"propertyOwners">[]> {
  const all = await ctx.db.query("propertyOwners").collect();
  return filterActiveOwnerships(all);
}
```

- [ ] **Step 2: Extend `listOwners` with unlinked owners**

Inside `listOwners`, find the `rows` type declaration (~line 77) and add the new field:

```ts
    const rows: Array<{
      userId: Id<"users">;
      name: string;
      email: string | undefined;
      propertyCount: number;
      lastStatement: {
        propertyName: string;
        periodStart: number;
        status: Doc<"ownerStatements">["status"];
      } | null;
      draftsPending: number;
      /** true = has the "owner" ROLE but zero active propertyOwners stakes. */
      unlinked: boolean;
    }> = [];
```

In the existing `rows.push({ … })` for linked owners (~line 117), add `unlinked: false,` after `draftsPending,`.

Then, directly **after** the `for (const [userId, ownerships] of byUser.entries()) { … }` loop closes and **before** `rows.sort(…)`, insert:

```ts
    // Role↔ownership drift: users flagged role="owner" who hold no active
    // stake. Surfaced here (instead of silently omitted) so admins see WHY
    // someone is missing from statements/portal and where to fix it.
    const allUsers = await ctx.db.query("users").collect();
    for (const u of allUsers) {
      if (u.role !== "owner" || byUser.has(u._id)) continue;
      rows.push({
        userId: u._id,
        name: u.name ?? u.email ?? "(unnamed owner)",
        email: u.email,
        propertyCount: 0,
        lastStatement: null,
        draftsPending: 0,
        unlinked: true,
      });
    }
```

- [ ] **Step 3: Render the drift warning on the page**

In `src/app/(dashboard)/admin/owner-overview/page.tsx`, after the `if (owners === undefined)` early-return, add:

```tsx
  const linked = owners.filter((o) => !o.unlinked);
  const unlinked = owners.filter((o) => o.unlinked);
```

Change the empty-state condition from `owners.length === 0` to `linked.length === 0`, and the table body from `owners.map((o) => (` to `linked.map((o) => (`.

Then insert this banner between `</header>` and the `{linked.length === 0 ? (` block:

```tsx
      {unlinked.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
          <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
            {unlinked.length === 1
              ? "1 user has the Owner role but no properties linked"
              : `${unlinked.length} users have the Owner role but no properties linked`}
          </p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            They won&apos;t appear in statements or the owner portal until
            linked. Fix under Properties → (their property) → Owners &amp; Fees
            → Edit.
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {unlinked.map((o) => (
              <li key={o.userId}>
                <span className="font-medium">{o.name}</span>
                {o.email && (
                  <span className="ml-2 text-xs text-[var(--muted-foreground)]">
                    {o.email}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
```

- [ ] **Step 4: Verify lint + build**

Run: `npm run lint && npm run build`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add convex/admin/ownerOverview.ts "src/app/(dashboard)/admin/owner-overview/page.tsx"
git commit -m "feat(owner-overview): surface owner-role users with no linked properties"
```

---

### Task 4: Schema — optional `ownerUserId` on `portfolioViews`

**Files:**
- Modify: `convex/schema.ts:1882-1888`

**Interfaces:**
- Produces: `portfolioViews.ownerUserId?: Id<"users">` — consumed by Task 5.
- Schema impact: **backward-compatible** (optional field, no index change, no backfill). Combined-PR exception in `.harness/convex.md` applies — do NOT split into a separate schema PR, and do NOT run any `npx convex` command from the worktree.

- [ ] **Step 1: Add the field**

Find in `convex/schema.ts` (~line 1879):

```ts
// Saved per-partner property subsets for the Monthly Close page. `clientName`
// is the optional company/owner label printed on the Chez Soi Stays statement
// ("Statement prepared for: {clientName}"). See convex/strCosts/views.ts.
const portfolioViews = defineTable({
  name: v.string(),
  clientName: v.optional(v.string()),
  propertyIds: v.array(v.id("properties")),
  createdAt: v.optional(v.number()),
  updatedAt: v.optional(v.number()),
});
```

Replace with:

```ts
// Saved per-partner property subsets for the Monthly Close page. `clientName`
// is the optional company/owner label printed on the Chez Soi Stays statement
// ("Statement prepared for: {clientName}"). See convex/strCosts/views.ts.
const portfolioViews = defineTable({
  name: v.string(),
  clientName: v.optional(v.string()),
  propertyIds: v.array(v.id("properties")),
  // When set, the view is BOUND to this owner: clientName + propertyIds are
  // derived LIVE from users + propertyOwners at read time (strCosts/views.
  // listViews). The stored clientName/propertyIds become a fallback snapshot,
  // used only if the owner loses all active stakes or the user row is gone.
  ownerUserId: v.optional(v.id("users")),
  createdAt: v.optional(v.number()),
  updatedAt: v.optional(v.number()),
});
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: no errors (nothing reads the field yet).

- [ ] **Step 3: Commit**

```bash
git add convex/schema.ts
git commit -m "feat(schema): optional ownerUserId binding on portfolioViews"
```

---

### Task 5: Live view resolution — bound views follow `propertyOwners`

**Files:**
- Create: `convex/strCosts/viewResolution.ts`
- Modify: `convex/strCosts/views.ts` (all of `listViews`, `saveView`, `listStatementClients`)
- Test: `tests/view-resolution.test.mjs`

**Interfaces:**
- Consumes: `resolveOwnerClient`, `groupActiveByUser`, `ClientNameSource` (Task 1); `portfolioViews.ownerUserId` (Task 4).
- Produces (consumed by Task 6):
  - `resolveViewFields<PropertyId extends string>(view, ownerUser, activePropertyIds): { clientName: string | undefined; propertyIds: PropertyId[]; isOwnerBound: boolean; ownerLinkBroken: boolean }`
  - `listViews` now returns each view doc spread with those four resolved fields (so `clientName`/`propertyIds` are LIVE for bound views).
  - `saveView` gains arg `ownerUserId: v.optional(v.id("users"))`; when set, the server derives+stores `clientName` itself (client-sent `clientName` is ignored).
  - `listStatementClients` rows unchanged in shape (`userId, name, company, client, email, propertyIds`) — internals refactored to shared helpers.

- [ ] **Step 1: Write the failing test**

Create `tests/view-resolution.test.mjs`:

```js
import { describe, it } from "node:test";
import assert from "node:assert";
import { resolveViewFields } from "../convex/strCosts/viewResolution.ts";

describe("resolveViewFields", () => {
  const stored = { clientName: "Custom Label", propertyIds: ["p1", "p2"] };

  it("passes stored fields through for unbound views", () => {
    assert.deepStrictEqual(resolveViewFields(stored, null, []), {
      clientName: "Custom Label",
      propertyIds: ["p1", "p2"],
      isOwnerBound: false,
      ownerLinkBroken: false,
    });
  });

  it("derives client + properties live from the owner for bound views", () => {
    const r = resolveViewFields(
      { ...stored, ownerUserId: "u1" },
      { name: "Tataw John", company: "Lisboa Holdings" },
      ["p9"],
    );
    assert.strictEqual(r.clientName, "Lisboa Holdings");
    assert.deepStrictEqual(r.propertyIds, ["p9"]);
    assert.strictEqual(r.isOwnerBound, true);
    assert.strictEqual(r.ownerLinkBroken, false);
  });

  it("falls back to the stored snapshot when the owner has no active stakes", () => {
    const r = resolveViewFields(
      { ...stored, ownerUserId: "u1" },
      { name: "Tataw John" },
      [],
    );
    assert.strictEqual(r.clientName, "Tataw John");
    assert.deepStrictEqual(r.propertyIds, ["p1", "p2"]);
    assert.strictEqual(r.ownerLinkBroken, true);
  });

  it("falls back entirely when the owner user record is missing", () => {
    const r = resolveViewFields({ ...stored, ownerUserId: "u1" }, null, []);
    assert.strictEqual(r.clientName, "Custom Label");
    assert.deepStrictEqual(r.propertyIds, ["p1", "p2"]);
    assert.strictEqual(r.ownerLinkBroken, true);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `node --test tests/view-resolution.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `convex/strCosts/viewResolution.ts`**

```ts
// Pure resolution of a portfolioViews row into what the Monthly Close UI and
// statement export should actually use. Owner-BOUND views (ownerUserId set)
// follow users + propertyOwners live; the stored clientName/propertyIds are
// only a fallback snapshot. Kept pure so it's unit-testable without Convex.

import { resolveOwnerClient, type ClientNameSource } from "../lib/ownership";

export interface StoredViewFields<PropertyId extends string> {
  clientName?: string;
  propertyIds: PropertyId[];
  ownerUserId?: string;
}

export interface ResolvedViewFields<PropertyId extends string> {
  clientName: string | undefined;
  propertyIds: PropertyId[];
  isOwnerBound: boolean;
  /** Bound view whose owner has no active stakes (or user row deleted). */
  ownerLinkBroken: boolean;
}

export function resolveViewFields<PropertyId extends string>(
  view: StoredViewFields<PropertyId>,
  ownerUser: ClientNameSource | null,
  activePropertyIds: PropertyId[],
): ResolvedViewFields<PropertyId> {
  if (view.ownerUserId === undefined) {
    return {
      clientName: view.clientName,
      propertyIds: view.propertyIds,
      isOwnerBound: false,
      ownerLinkBroken: false,
    };
  }
  const broken = ownerUser === null || activePropertyIds.length === 0;
  return {
    clientName: ownerUser !== null ? resolveOwnerClient(ownerUser) : view.clientName,
    propertyIds: broken ? view.propertyIds : activePropertyIds,
    isOwnerBound: true,
    ownerLinkBroken: broken,
  };
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `node --test tests/view-resolution.test.mjs`
Expected: PASS (4 subtests).

- [ ] **Step 5: Rewrite `convex/strCosts/views.ts` to use the resolver**

Replace the **entire file** with:

```ts
import { query, mutation } from "../_generated/server";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { groupActiveByUser, resolveOwnerClient } from "../lib/ownership";
import { resolveViewFields } from "./viewResolution";

/**
 * List all saved portfolio views, ordered by name.
 *
 * Owner-BOUND views (ownerUserId set) come back with clientName and
 * propertyIds derived LIVE from users + propertyOwners, so the Monthly Close
 * table and statement export always reflect current ownership. Unbound views
 * pass their stored fields through unchanged.
 */
export const listViews = query({
  args: {},
  handler: async (ctx) => {
    const views = await ctx.db.query("portfolioViews").collect();
    const resolved = await Promise.all(
      views.map(async (view) => {
        const ownerUserId = view.ownerUserId;
        if (ownerUserId === undefined) {
          return { ...view, ...resolveViewFields(view, null, []) };
        }
        const [user, stakes] = await Promise.all([
          ctx.db.get(ownerUserId),
          ctx.db
            .query("propertyOwners")
            .withIndex("by_user_and_active", (q) =>
              q.eq("userId", ownerUserId).eq("effectiveTo", undefined),
            )
            .collect(),
        ]);
        const activePropertyIds = [...new Set(stakes.map((s) => s.propertyId))];
        return { ...view, ...resolveViewFields(view, user, activePropertyIds) };
      }),
    );
    return resolved.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/**
 * Create a new portfolio view, or update an existing one.
 * - If `id` is provided, patches the existing record and returns its id.
 * - Otherwise, inserts a new record and returns the new id.
 * - If `ownerUserId` is provided the view is BOUND: the server derives the
 *   stored clientName from the owner's profile (company, else name) so it can
 *   never drift from users/propertyOwners. Passing ownerUserId: undefined on
 *   an update UNBINDS the view (Convex patch removes undefined fields).
 */
export const saveView = mutation({
  args: {
    id: v.optional(v.id("portfolioViews")),
    name: v.string(),
    clientName: v.optional(v.string()),
    propertyIds: v.array(v.id("properties")),
    ownerUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    let clientName = args.clientName;
    if (args.ownerUserId !== undefined) {
      const owner = await ctx.db.get(args.ownerUserId);
      if (!owner) throw new ConvexError("Owner user not found");
      clientName = resolveOwnerClient(owner);
    }
    if (args.id !== undefined) {
      await ctx.db.patch(args.id, {
        name: args.name,
        clientName,
        propertyIds: args.propertyIds,
        ownerUserId: args.ownerUserId,
        updatedAt: Date.now(),
      });
      return args.id;
    }
    return await ctx.db.insert("portfolioViews", {
      name: args.name,
      clientName,
      propertyIds: args.propertyIds,
      ownerUserId: args.ownerUserId,
      createdAt: Date.now(),
    });
  },
});

/**
 * Delete a saved portfolio view by id.
 */
export const deleteView = mutation({
  args: {
    id: v.id("portfolioViews"),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return null;
  },
});

/**
 * Owners we manage (from `propertyOwners`), for the "Client / company" picker
 * on the saved-view editor. One row per owner-user with an active stake, plus
 * the property ids they hold — so selecting an owner can auto-scope the view
 * to their properties. Active stake = `effectiveTo === undefined` (same rule
 * as convex/lib/ownership helpers).
 */
export const listStatementClients = query({
  args: {},
  handler: async (ctx) => {
    const ownerships = await ctx.db.query("propertyOwners").collect();
    const byUser = groupActiveByUser(ownerships);

    const rows: Array<{
      userId: string;
      name: string;
      company: string | null;
      /** What prints on the statement: company if set, else the owner's name. */
      client: string;
      email: string | null;
      propertyIds: string[];
    }> = [];
    for (const [userId, stakes] of byUser.entries()) {
      const user = await ctx.db.get(userId as Id<"users">);
      if (!user) continue;
      const name = user.name ?? user.email ?? "(unnamed owner)";
      const company = user.company?.trim() || null;
      rows.push({
        userId,
        name,
        company,
        client: resolveOwnerClient(user),
        email: user.email ?? null,
        propertyIds: [...new Set(stakes.map((s) => s.propertyId as string))],
      });
    }
    rows.sort((a, b) => a.client.localeCompare(b.client));
    return rows;
  },
});
```

- [ ] **Step 6: Verify lint + types + tests**

Run: `npm run lint && npx tsc --noEmit && npm test`
Expected: all green. (If `tsc` complains that `user.company` doesn't satisfy `ClientNameSource`, check the `users` table has `company: v.optional(v.string())` in schema — it does; the Doc type `string | undefined` is assignable to `string | null | undefined`.)

- [ ] **Step 7: Commit**

```bash
git add convex/strCosts/viewResolution.ts convex/strCosts/views.ts tests/view-resolution.test.mjs
git commit -m "feat(monthly-close): owner-bound views derive client + properties live from propertyOwners"
```

---

### Task 6: ViewManager + statement dialog — bind views to owners in the UI

**Files:**
- Modify: `src/admin/tools/monthly-close/ViewManager.tsx`
- Modify: `src/admin/tools/monthly-close/App.tsx` (statement dialog, ~lines 246-274)

**Interfaces:**
- Consumes: `saveView({ …, ownerUserId? })`, enriched `listViews` rows with `ownerUserId`, `isOwnerBound`, `ownerLinkBroken` (Task 5); `listStatementClients` rows keyed by `userId`.
- Produces: UI behavior only. Binding rules: picking an owner in the dropdown binds the view (stores `ownerUserId`); picking "— None —" or manually toggling any property checkbox unbinds it.

- [ ] **Step 1: Rework `ViewManager.tsx` owner selection**

Apply these exact edits:

1. Add sentinel constants after the imports (below line 9):

```tsx
const OWNER_NONE = "";
const OWNER_CUSTOM = "__custom__";
```

2. Add binding state next to the existing `clientName` state (line 40):

```tsx
  const [clientName, setClientName] = useState("");
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null);
```

3. Seed it in the open-effect. Find (lines 45-56):

```tsx
  useEffect(() => {
    if (!open) return;
    if (activeView) {
      setName(activeView.name);
      setClientName(activeView.clientName ?? "");
      setCheckedIds(new Set(activeView.propertyIds as string[]));
    } else {
      setName("");
      setClientName("");
      setCheckedIds(new Set((allProps ?? []).map((p) => p._id as string)));
    }
  }, [open, activeView, allProps]);
```

Replace with:

```tsx
  useEffect(() => {
    if (!open) return;
    if (activeView) {
      setName(activeView.name);
      setClientName(activeView.clientName ?? "");
      setOwnerUserId((activeView.ownerUserId as string | undefined) ?? null);
      setCheckedIds(new Set(activeView.propertyIds as string[]));
    } else {
      setName("");
      setClientName("");
      setOwnerUserId(null);
      setCheckedIds(new Set((allProps ?? []).map((p) => p._id as string)));
    }
  }, [open, activeView, allProps]);
```

4. Manual property edits unbind. Find `toggleProp` (lines 58-65) and replace with:

```tsx
  function toggleProp(id: string) {
    if (ownerUserId !== null) {
      // Editing the property list contradicts "follow the owner" — unbind so
      // the view is explicitly manual instead of silently diverging.
      setOwnerUserId(null);
      showToast("View unlinked from owner — property list is now manual.", "success");
    }
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
```

5. Replace `handleClientChange` (lines 67-75) with:

```tsx
  // Picking an owner BINDS the view: client + properties follow their
  // ownership records live. "None"/custom leaves the view manual.
  function handleOwnerChange(value: string) {
    if (value === OWNER_NONE) {
      setOwnerUserId(null);
      setClientName("");
      return;
    }
    if (value === OWNER_CUSTOM) {
      setOwnerUserId(null); // keep clientName as a free-form label
      return;
    }
    const owner = owners?.find((o) => o.userId === value);
    if (!owner) return;
    setOwnerUserId(owner.userId);
    setClientName(owner.client);
    if (owner.propertyIds.length > 0) setCheckedIds(new Set(owner.propertyIds));
  }
```

6. Pass the binding on save. In `handleSave`, find the `saveView({ … })` call (lines 91-96) and replace with:

```tsx
      const id = await saveView({
        id: asNew || !activeViewId ? undefined : (activeViewId as Id<"portfolioViews">),
        name: trimmed,
        // Bound views: the server derives clientName from the owner profile.
        clientName: ownerUserId !== null ? undefined : clientName.trim() || undefined,
        propertyIds,
        ownerUserId: ownerUserId !== null ? (ownerUserId as Id<"users">) : undefined,
      });
```

7. Rewire the `<Select>` (lines 148-176). Replace the whole "Client / company" block with:

```tsx
          <div className="space-y-1">
            <Label htmlFor="view-client-name">Client / company (for statements)</Label>
            <Select
              id="view-client-name"
              value={ownerUserId ?? (clientName ? OWNER_CUSTOM : OWNER_NONE)}
              onChange={(e) => handleOwnerChange(e.target.value)}
              className="w-full"
            >
              <option value={OWNER_NONE}>— None —</option>
              {/* Preserve a custom label saved before owner-binding existed */}
              {ownerUserId === null && clientName && (
                <option value={OWNER_CUSTOM}>{clientName} (custom)</option>
              )}
              {(owners ?? []).map((o) => (
                <option key={o.userId} value={o.userId}>
                  {o.client}
                  {o.company ? ` (${o.name})` : ""}
                  {o.propertyIds.length > 0
                    ? ` · ${o.propertyIds.length} ${o.propertyIds.length === 1 ? "property" : "properties"}`
                    : ""}
                </option>
              ))}
            </Select>
            {ownerUserId !== null ? (
              <p className="text-xs text-[var(--muted-foreground)]">
                Linked to this owner — the statement client and property list
                follow their ownership records automatically. Editing the
                checkboxes below unlinks the view.
              </p>
            ) : (
              <p className="text-xs text-[var(--muted-foreground)]">
                Owners come from the properties you manage; the statement shows
                their company (or name if none). Selecting one links the view to
                that owner.
              </p>
            )}
            {activeView?.ownerLinkBroken ? (
              <p className="text-xs font-medium text-amber-600">
                The linked owner currently has no active properties — showing the
                saved list instead.
              </p>
            ) : null}
          </div>
```

- [ ] **Step 2: Statement dialog hint in `App.tsx`**

In `src/admin/tools/monthly-close/App.tsx`, inside the "Export Owner Statement" modal, find (~lines 250-259):

```tsx
          <div className="space-y-1">
            <Label htmlFor="stmt-client-name">Client / company</Label>
            <Input
              id="stmt-client-name"
              value={stmtClientName}
              onChange={(e) => setStmtClientName(e.target.value)}
              placeholder="e.g. Acme Realty LLC"
              autoFocus
            />
          </div>
```

Replace with:

```tsx
          <div className="space-y-1">
            <Label htmlFor="stmt-client-name">Client / company</Label>
            <Input
              id="stmt-client-name"
              value={stmtClientName}
              onChange={(e) => setStmtClientName(e.target.value)}
              placeholder="e.g. Acme Realty LLC"
              autoFocus
            />
            {activeView?.ownerUserId ? (
              <p className="text-xs text-[var(--muted-foreground)]">
                Prefilled from the linked owner&apos;s profile (company, else
                name) — kept in sync with their ownership records.
              </p>
            ) : null}
          </div>
```

No other `App.tsx` change is needed: `handleOpenStatementDialog` already reads `views.find(…)?.clientName`, and `selectedPropertyIds` already reads `activeView.propertyIds` — both are now live-derived for bound views by Task 5.

- [ ] **Step 3: Verify lint + build + tests**

Run: `npm run lint && npm test && npm run build`
Expected: all green (the mutation-loop-guard test scans these files — the edits add no `useMutation` values to dependency arrays, so it stays green).

- [ ] **Step 4: Commit**

```bash
git add src/admin/tools/monthly-close/ViewManager.tsx src/admin/tools/monthly-close/App.tsx
git commit -m "feat(monthly-close): bind saved views to owners in ViewManager; unbind on manual edits"
```

---

### Task 7: Final verification, PR, and harness handoff

**Files:**
- Create: `.harness/handoffs/TASK-OWNER-CONSISTENCY-001/worktree-handoff.md`
- Modify: `.harness/integration-queue.md` (append under `## Ready`)

- [ ] **Step 1: Full local gate**

```bash
npm run lint && npm test && npm run build
```

Expected: zero errors. Do NOT run any `npx convex` command — the main session deploys after merge.

- [ ] **Step 2: Rebase + push + open PR**

```bash
git fetch origin && git rebase origin/main
git push -u origin task/owner-consistency
gh pr create --title "feat(owners): propertyOwners as single source of truth across Team, Owner Overview, Monthly Close" --body "$(cat <<'EOF'
## Summary
- Team page: owner-role users with zero active propertyOwners stakes get a visible "No properties linked" flag (new `ownedPropertyCount` on getTeamMetrics rows)
- Owner Overview: unlinked owner-role users are listed in an amber warning section instead of silently omitted (new `unlinked` flag on listOwners rows)
- Monthly Close: portfolioViews gain optional `ownerUserId`; bound views derive clientName + propertyIds LIVE from users + propertyOwners at read time (pure resolver in strCosts/viewResolution.ts, unit-tested); ViewManager binds via owner picker and unbinds on manual property edits
- Shared pure helpers in convex/lib/ownership.ts (active-stake filter, company-else-name client label) now used by all three surfaces

## Schema impact
backward-compatible — one optional field (`portfolioViews.ownerUserId`), no index changes, no backfill. Combined-PR exception per .harness/convex.md.

## Test plan
- [ ] `npm test` (ownership-helpers, view-resolution, mutation-loop-guard)
- [ ] `npm run lint && npm run build`
- [ ] Main session after merge: `npx convex dev --once`, then manual checklist in Docs/2026-07-04-owner-consistency-plan.md §Manual verification
EOF
)"
```

- [ ] **Step 3: Write the handoff file**

Create `.harness/handoffs/TASK-OWNER-CONSISTENCY-001/worktree-handoff.md`:

```markdown
# TASK-OWNER-CONSISTENCY-001 — worktree handoff

- Branch: task/owner-consistency
- PR: <link from step 2>
- Schema impact: backward-compatible (portfolioViews.ownerUserId, optional, no index/backfill)
- Convex deploy needed after merge: yes (schema + query/mutation changes) — main session runs it
- Mobile impact: none (admin-only queries; cleaners app does not call admin.* or strCosts.*; still run `npm run sync:convex-backend` in jna-cleaners-app after deploy per standard procedure)
- Touched: convex/lib/ownership.ts (new), convex/strCosts/viewResolution.ts (new),
  convex/strCosts/views.ts, convex/admin/queries.ts, convex/admin/ownerOverview.ts,
  convex/schema.ts, team/page.tsx, admin/owner-overview/page.tsx,
  monthly-close/ViewManager.tsx, monthly-close/App.tsx, tests/*
- Tests: tests/ownership-helpers.test.mjs, tests/view-resolution.test.mjs (node --test)
- Manual verification: see Docs/2026-07-04-owner-consistency-plan.md §Manual verification
```

Commit the handoff on the branch, then append this entry to `.harness/integration-queue.md` under `## Ready` (commit that too):

```markdown
- TASK-OWNER-CONSISTENCY-001 — owner single-source-of-truth (Team/Overview/Monthly Close) — PR <#> — schema: backward-compatible — handoff: .harness/handoffs/TASK-OWNER-CONSISTENCY-001/worktree-handoff.md
```

```bash
git add .harness/handoffs/TASK-OWNER-CONSISTENCY-001/worktree-handoff.md .harness/integration-queue.md
git commit -m "chore(harness): handoff for TASK-OWNER-CONSISTENCY-001"
git push
```

- [ ] **Step 4: Stop — do not merge**

The main session merges, runs `npx convex dev --once` / deploys, and executes the manual verification below. Do not merge your own PR (harness rule).

## Manual verification (main session, after merge + convex deploy)

1. **Team page** (`/team`): Tataw John (role Owner, no stakes) shows the amber "No properties linked" flag in card, list, and table layouts. Randalls shows no flag.
2. **Owner Overview** (`/admin/owner-overview`): amber banner lists Tataw John; Randalls still renders as a normal row with 7 properties.
3. **Link Tataw**: Properties → Houston-The Lisboa → Owners & Fees → Edit → add Tataw at 100%. The Team-page flag and the Overview banner both disappear; Tataw appears as an Overview row with 1 property.
4. **Monthly Close** (`/reports/monthly-close`): New view… → pick Tataw in the Client/company dropdown → properties auto-scope to Houston-The Lisboa; save. Export PDF prefills his company (else name).
5. **Liveness**: add a second property to Tataw via Owners & Fees; reopen Monthly Close — the bound view now shows both properties without editing the view.
6. **Unbind**: in Edit view…, untoggle a property → toast "View unlinked from owner…", save; the view stops following ownership changes.
7. **Legacy views**: pre-existing views (no ownerUserId) behave exactly as before, including any custom "(custom)" client label.
