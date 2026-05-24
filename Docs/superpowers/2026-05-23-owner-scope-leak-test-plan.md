# Owner-Portal Scope-Leak Test Plan

**Goal:** Verify Owner A cannot read or write any data belonging to Owner B.

**Status:** Backend audit complete (2026-05-23) — every owner-facing function
gates through `requireOwnerUser` / `assertOwnerOfProperty` /
`assertPrimaryApprover` from `convex/owner/auth.ts`. This doc captures the
manual test procedure to confirm in production.

---

## Auth helpers (the gate)

Every public owner query/mutation runs one of:

| Helper | When | Throws if |
|---|---|---|
| `requireOwnerUser(ctx)` | Caller-scoped reads (own user data, own inbox) | Caller's `users.role !== "owner"` |
| `assertOwnerOfProperty(ctx, propertyId)` | Property-scoped reads | No active `propertyOwners` row for (caller.userId, propertyId) |
| `assertPrimaryApprover(ctx, propertyId)` | Decisions reserved to primary owner | Above + `isPrimaryApprover !== true` |

Active = `propertyOwners.effectiveTo === undefined` AND `effectiveFrom <= now`.

---

## Setup for the test

1. Create two owner users (call them Owner A and Owner B) — via Clerk sign-up.
2. Promote both to `role="owner"` via Team page (this now also patches
   Clerk publicMetadata + revokes sessions — see Wave 5a fix).
3. Assign Property P1 to Owner A only (via Property → Owners & Fees card).
4. Assign Property P2 to Owner B only.
5. Sign in as Owner A.

## Tests (run in browser DevTools Console while signed in as Owner A)

The Convex client is exposed as `window.__convex` in dev. Each test below
expects `throw` from the backend (caught by Convex client as an Error).

### T1 — Dashboard scope
```ts
const d = await window.__convex.query("owner/queries:getOwnerDashboard", { });
console.log(d.properties.map(p => p.propertyName));
// PASS iff: list contains only P1, NOT P2
```

### T2 — Direct property read attempt
```ts
await window.__convex.query("owner/queries:getOwnerProperty", { propertyId: P2 });
// PASS iff: throws "User <X> is not an active owner of property <P2>"
```

### T3 — Statement draft for foreign property
```ts
await window.__convex.query("owner/queries:getOwnerStatementDraft", { propertyId: P2 });
// PASS iff: throws ownership error
```

### T4 — Approval for foreign property's pending request
```ts
// Ops creates a maintenance request on P2 → req2_id
await window.__convex.mutation("owner/mutations:decideMaintenanceApprovalRequest", {
  requestId: req2_id, decision: "approved",
});
// PASS iff: throws "Only the primary approver snapshotted on the request may decide it."
```

### T5 — Date block on foreign property
```ts
await window.__convex.mutation("owner/mutations:createOwnerDateBlock", {
  propertyId: P2, startDate: Date.now(), endDate: Date.now() + 86400000,
});
// PASS iff: throws ownership error
```

### T6 — Notification inbox scope
```ts
const n = await window.__convex.query("owner/queries:listOwnerNotifications", { });
// PASS iff: every notification's data.propertyId (where present) is P1
```

### T7 — Statement detail for foreign property
```ts
// Find a B-owned statement id via Convex dashboard
await window.__convex.query("owner/queries:getOwnerStatement", { statementId: BS_id });
// PASS iff: throws ownership error
```

### T8 — PDF URL for foreign statement
```ts
await window.__convex.query("owner/queries:getOwnerStatementPdfUrl", { statementId: BS_id });
// PASS iff: throws ownership error
```

### T9 — Mark-read on foreign notification
```ts
// Find a B-owned notification id via Convex dashboard
await window.__convex.mutation("owner/mutations:markOwnerNotificationRead", {
  notificationId: BN_id,
});
// PASS iff: throws "Notification does not belong to caller"
```

### T10 — Inverse: sign in as Owner B, repeat with P1/A's data
Symmetry check.

---

## Backend-side verification (faster than browser)

For automated CI someday: add a Convex test that exercises every owner
mutation/query through a non-owning identity and asserts each throws.
Pattern:

```ts
// convex/owner/__tests__/scopeLeak.test.ts
test("getOwnerStatement throws for non-owner", async () => {
  const ctx = testCtxAsUser(USER_NOT_OWNING_PROPERTY);
  await assert.rejects(getOwnerStatement(ctx, { statementId: P1_STATEMENT }));
});
```

Convex's `convex-test` runtime supports this; not yet wired in this repo.

---

## Known scope-leak vectors (must remain mitigated)

1. **Snapshot vs current ownership.** `decideMaintenanceApprovalRequest`
   uses the row's `ownerId` snapshot (set at request creation). If Owner A
   was primary when the request was created, then ownership transfers to
   Owner B mid-request lifecycle, can Owner B decide it? **No** — the
   mutation looks up the snapshot row and matches its `userId` to the
   caller. Owner B can't decide because the snapshot points at A.

2. **Closed ownership.** `pickOwnersForPeriod(periodStart)` excludes rows
   with `effectiveTo > periodStart` only if the period started before the
   row was closed. Statements issued for a period when the owner WAS active
   correctly include them in `perOwner`; the fee engine's stake-sum
   invariant catches misconfigurations.

3. **Duplicate active rows.** A bug fixed on 2026-05-23 — the bulk-seed
   mutation could leave two `effectiveTo=undefined` rows for the same
   property, producing `stakePct sum = 2.0` and engine-throw. Repaired
   via `repairDuplicateActiveOwners`. Going forward, all owner-write
   mutations close existing active rows BEFORE inserting new ones.
