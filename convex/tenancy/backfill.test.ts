import test from "node:test";
import assert from "node:assert/strict";

import { runJnaOrganizationBackfill, JNA_ORG_SLUG } from "./backfillCore.ts";
import type { MutationCtx } from "../_generated/server";

// ─────────────────────────────────────────────────────────────────────────────
// Minimal in-memory MutationCtx fake supporting the ops the backfill uses:
// query(table).withIndex(name, q => q.eq(field, value)).first() / .collect(),
// db.insert(table, doc), db.patch(id, patch). Mirrors companyScope.test.ts.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown> & { _id: string };

function makeCtx(tables: Record<string, Row[]>) {
  let counter = 0;
  const build = (rows: Row[]) => ({
    withIndex(_indexName: string, predicate: (q: unknown) => unknown) {
      const calls: Array<[string, unknown]> = [];
      const recorder = {
        eq(field: string, value: unknown) {
          calls.push([field, value]);
          return recorder;
        },
      };
      predicate(recorder);
      return build(
        rows.filter((row) => calls.every(([f, v]) => row[f] === v)),
      );
    },
    collect: async () => rows,
    first: async () => rows[0] ?? null,
  });

  const ctx = {
    db: {
      query(table: string) {
        tables[table] = tables[table] ?? [];
        return build(tables[table]);
      },
      async insert(table: string, doc: Record<string, unknown>) {
        tables[table] = tables[table] ?? [];
        const _id = `${table}_${(counter += 1)}`;
        tables[table].push({ _id, ...doc });
        return _id;
      },
      async patch(id: string, patch: Record<string, unknown>) {
        for (const rows of Object.values(tables)) {
          const row = rows.find((r) => r._id === id);
          if (row) {
            Object.assign(row, patch);
            return;
          }
        }
      },
    },
  };
  return ctx as unknown as MutationCtx;
}

test("backfill creates the J&A org and links all unlinked companies", async () => {
  const tables: Record<string, Row[]> = {
    organizations: [],
    cleaningCompanies: [
      { _id: "c1", name: "Dallas" },
      { _id: "c2", name: "Austin" },
    ],
  };
  const result = await runJnaOrganizationBackfill(makeCtx(tables), 1000);

  assert.equal(result.organizationCreated, true);
  assert.equal(result.companiesLinked, 2);
  assert.equal(result.companiesAlreadyLinked, 0);
  assert.equal(tables.organizations.length, 1);
  assert.equal(tables.organizations[0].slug, JNA_ORG_SLUG);
  assert.ok(
    tables.cleaningCompanies.every(
      (c) => c.organizationId === result.organizationId,
    ),
    "every company should be linked to the org",
  );
});

test("backfill is idempotent: re-run creates and links nothing", async () => {
  const tables: Record<string, Row[]> = {
    organizations: [],
    cleaningCompanies: [{ _id: "c1", name: "Dallas" }],
  };
  const ctx = makeCtx(tables);
  const first = await runJnaOrganizationBackfill(ctx, 1000);
  const second = await runJnaOrganizationBackfill(ctx, 2000);

  assert.equal(second.organizationCreated, false);
  assert.equal(second.companiesLinked, 0);
  assert.equal(second.companiesAlreadyLinked, 1);
  assert.equal(tables.organizations.length, 1);
  assert.equal(first.organizationId, second.organizationId);
});

test("backfill only links companies missing an organizationId", async () => {
  const tables: Record<string, Row[]> = {
    organizations: [],
    cleaningCompanies: [
      { _id: "c1", name: "Dallas" },
      { _id: "c2", name: "Prelinked", organizationId: "org_existing" },
    ],
  };
  const result = await runJnaOrganizationBackfill(makeCtx(tables), 1000);

  assert.equal(result.companiesLinked, 1);
  assert.equal(result.companiesAlreadyLinked, 1);
  assert.equal(
    tables.cleaningCompanies.find((c) => c._id === "c2")?.organizationId,
    "org_existing",
    "an already-linked company must not be relinked",
  );
});
