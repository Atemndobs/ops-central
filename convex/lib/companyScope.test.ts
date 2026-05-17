import test from "node:test";
import assert from "node:assert/strict";

import {
  canCallerAccessPropertyById,
  getCallerJobScopeForListing,
} from "./companyScope";

// ─────────────────────────────────────────────────────────────────────────────
// Minimal in-memory ctx fake.
//
// The companyScope helpers only call `ctx.db.query(table).withIndex(name, q =>
// q.eq(field, value)).collect()`. We model `withIndex` as a filter applied to
// the table store, capturing the field/value pair via a stub `q.eq` recorder.
// This isolates the auth logic from Convex internals so we can test the
// company-scope matrix without booting a real deployment.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown> & { _id: string };

function makeCtx(tables: Record<string, Row[]>) {
  return {
    db: {
      query(table: string) {
        const rows = tables[table] ?? [];
        return {
          withIndex(
            _indexName: string,
            predicate: (q: {
              eq: (field: string, value: unknown) => {
                eq: (field: string, value: unknown) => unknown;
              };
            }) => unknown,
          ) {
            const calls: Array<[string, unknown]> = [];
            const recorder = {
              eq(field: string, value: unknown) {
                calls.push([field, value]);
                return recorder;
              },
            };
            predicate(recorder);
            const filtered = rows.filter((row) =>
              calls.every(([field, value]) => row[field] === value),
            );
            return {
              collect: async () => filtered,
            };
          },
        };
      },
    },
  } as unknown as Parameters<typeof getCallerJobScopeForListing>[0];
}

const SOFIA = "company_sofia";
const OTHER = "company_other";
const PROP_A = "prop_a";
const PROP_B = "prop_b";
const PROP_C_OTHER = "prop_c";

// ─────────────────────────────────────────────────────────────────────────────
// getCallerJobScopeForListing
// ─────────────────────────────────────────────────────────────────────────────

test("getCallerJobScopeForListing: admin sees no scope (null)", async () => {
  const ctx = makeCtx({});
  const scope = await getCallerJobScopeForListing(ctx, {
    _id: "u1",
    role: "admin",
  } as never);
  assert.equal(scope, null);
});

test("getCallerJobScopeForListing: property_ops sees no scope (null)", async () => {
  const ctx = makeCtx({});
  const scope = await getCallerJobScopeForListing(ctx, {
    _id: "u1",
    role: "property_ops",
  } as never);
  assert.equal(scope, null);
});

test("getCallerJobScopeForListing: cleaner returns empty set", async () => {
  const ctx = makeCtx({});
  const scope = await getCallerJobScopeForListing(ctx, {
    _id: "u1",
    role: "cleaner",
  } as never);
  assert.ok(scope instanceof Set);
  assert.equal(scope!.size, 0);
});

test("getCallerJobScopeForListing: manager with no membership returns empty set", async () => {
  const ctx = makeCtx({ companyMembers: [], companyProperties: [] });
  const scope = await getCallerJobScopeForListing(ctx, {
    _id: "u_jesse",
    role: "manager",
  } as never);
  assert.ok(scope instanceof Set);
  assert.equal(scope!.size, 0);
});

test("getCallerJobScopeForListing: manager with cleaner-only membership returns empty set", async () => {
  const ctx = makeCtx({
    companyMembers: [
      {
        _id: "m1",
        userId: "u_jesse",
        companyId: SOFIA,
        role: "cleaner",
        isActive: true,
        joinedAt: 1,
      },
    ],
    companyProperties: [
      { _id: "cp1", companyId: SOFIA, propertyId: PROP_A, assignedAt: 1 },
    ],
  });
  const scope = await getCallerJobScopeForListing(ctx, {
    _id: "u_jesse",
    role: "manager",
  } as never);
  assert.ok(scope instanceof Set);
  assert.equal(scope!.size, 0);
});

test("getCallerJobScopeForListing: manager with manager membership scopes to active company properties", async () => {
  const ctx = makeCtx({
    companyMembers: [
      {
        _id: "m1",
        userId: "u_jesse",
        companyId: SOFIA,
        role: "manager",
        isActive: true,
        joinedAt: 1,
      },
    ],
    companyProperties: [
      { _id: "cp1", companyId: SOFIA, propertyId: PROP_A, assignedAt: 1, isActive: true },
      { _id: "cp2", companyId: SOFIA, propertyId: PROP_B, assignedAt: 2, isActive: true },
      // belongs to a different company — must NOT leak
      { _id: "cp3", companyId: OTHER, propertyId: PROP_C_OTHER, assignedAt: 3, isActive: true },
    ],
  });
  const scope = await getCallerJobScopeForListing(ctx, {
    _id: "u_jesse",
    role: "manager",
  } as never);
  assert.ok(scope instanceof Set);
  assert.deepEqual([...scope!].sort(), [PROP_A, PROP_B]);
});

test("getCallerJobScopeForListing: unassigned (inactive) companyProperties row is excluded", async () => {
  const ctx = makeCtx({
    companyMembers: [
      {
        _id: "m1",
        userId: "u_jesse",
        companyId: SOFIA,
        role: "manager",
        isActive: true,
        joinedAt: 1,
      },
    ],
    companyProperties: [
      { _id: "cp1", companyId: SOFIA, propertyId: PROP_A, assignedAt: 1, isActive: true },
      // recently unassigned — should not appear in scope
      { _id: "cp2", companyId: SOFIA, propertyId: PROP_B, assignedAt: 2, isActive: false, unassignedAt: 5 },
    ],
  });
  const scope = await getCallerJobScopeForListing(ctx, {
    _id: "u_jesse",
    role: "manager",
  } as never);
  assert.deepEqual([...scope!], [PROP_A]);
});

test("getCallerJobScopeForListing: revoked membership is ignored (fail-closed)", async () => {
  const ctx = makeCtx({
    companyMembers: [
      {
        _id: "m1",
        userId: "u_jesse",
        companyId: SOFIA,
        role: "manager",
        isActive: false,
        joinedAt: 1,
        leftAt: 99,
      },
    ],
    companyProperties: [
      { _id: "cp1", companyId: SOFIA, propertyId: PROP_A, assignedAt: 1, isActive: true },
    ],
  });
  const scope = await getCallerJobScopeForListing(ctx, {
    _id: "u_jesse",
    role: "manager",
  } as never);
  assert.equal(scope!.size, 0);
});

test("getCallerJobScopeForListing: owner membership grants scope same as manager", async () => {
  const ctx = makeCtx({
    companyMembers: [
      {
        _id: "m1",
        userId: "u_owner",
        companyId: SOFIA,
        role: "owner",
        isActive: true,
        joinedAt: 1,
      },
    ],
    companyProperties: [
      { _id: "cp1", companyId: SOFIA, propertyId: PROP_A, assignedAt: 1, isActive: true },
    ],
  });
  const scope = await getCallerJobScopeForListing(ctx, {
    _id: "u_owner",
    role: "manager",
  } as never);
  assert.deepEqual([...scope!], [PROP_A]);
});

// ─────────────────────────────────────────────────────────────────────────────
// canCallerAccessPropertyById
// ─────────────────────────────────────────────────────────────────────────────

test("canCallerAccessPropertyById: admin always true", async () => {
  const ctx = makeCtx({});
  assert.equal(
    await canCallerAccessPropertyById(
      ctx,
      { _id: "u1", role: "admin" } as never,
      PROP_A as never,
    ),
    true,
  );
});

test("canCallerAccessPropertyById: property_ops always true", async () => {
  const ctx = makeCtx({});
  assert.equal(
    await canCallerAccessPropertyById(
      ctx,
      { _id: "u1", role: "property_ops" } as never,
      PROP_A as never,
    ),
    true,
  );
});

test("canCallerAccessPropertyById: cleaner always false (uses other path)", async () => {
  const ctx = makeCtx({});
  assert.equal(
    await canCallerAccessPropertyById(
      ctx,
      { _id: "u1", role: "cleaner" } as never,
      PROP_A as never,
    ),
    false,
  );
});

test("canCallerAccessPropertyById: manager-in-Sofia true for Sofia-assigned property", async () => {
  const ctx = makeCtx({
    companyMembers: [
      {
        _id: "m1",
        userId: "u_jesse",
        companyId: SOFIA,
        role: "manager",
        isActive: true,
        joinedAt: 1,
      },
    ],
    companyProperties: [
      { _id: "cp1", companyId: SOFIA, propertyId: PROP_A, assignedAt: 1, isActive: true },
    ],
  });
  assert.equal(
    await canCallerAccessPropertyById(
      ctx,
      { _id: "u_jesse", role: "manager" } as never,
      PROP_A as never,
    ),
    true,
  );
});

test("canCallerAccessPropertyById: manager-in-Sofia false for OTHER-assigned property (R5 #3)", async () => {
  const ctx = makeCtx({
    companyMembers: [
      {
        _id: "m1",
        userId: "u_jesse",
        companyId: SOFIA,
        role: "manager",
        isActive: true,
        joinedAt: 1,
      },
    ],
    companyProperties: [
      { _id: "cp1", companyId: SOFIA, propertyId: PROP_A, assignedAt: 1, isActive: true },
      { _id: "cp2", companyId: OTHER, propertyId: PROP_C_OTHER, assignedAt: 1, isActive: true },
    ],
  });
  assert.equal(
    await canCallerAccessPropertyById(
      ctx,
      { _id: "u_jesse", role: "manager" } as never,
      PROP_C_OTHER as never,
    ),
    false,
  );
});

test("canCallerAccessPropertyById: manager false for unassigned property (no companyProperties row)", async () => {
  const ctx = makeCtx({
    companyMembers: [
      {
        _id: "m1",
        userId: "u_jesse",
        companyId: SOFIA,
        role: "manager",
        isActive: true,
        joinedAt: 1,
      },
    ],
    companyProperties: [],
  });
  assert.equal(
    await canCallerAccessPropertyById(
      ctx,
      { _id: "u_jesse", role: "manager" } as never,
      PROP_A as never,
    ),
    false,
  );
});
