import { test } from "node:test";
import assert from "node:assert/strict";
import schema from "../schema.ts";

/**
 * Multi-tenancy Phase 1 schema verification.
 * Mirrors schemaShape.test.ts: inspect the compiled schema object, no Convex boot.
 */

const tables = (
  schema as unknown as {
    tables: Record<string, { validator: { fields: Record<string, unknown> } }>;
  }
).tables;

test("Phase 1: organizations table is registered in defineSchema", () => {
  assert.ok(
    Object.keys(tables).includes("organizations"),
    'expected "organizations" table to be registered in convex/schema.ts',
  );
});

test("Phase 1: organizations declares the expected fields", () => {
  const fields = tables.organizations.validator.fields;
  for (const f of [
    "name",
    "slug",
    "status",
    "plan",
    "clerkOrgId",
    "stripeCustomerId",
    "stripeSubscriptionId",
    "trialEndsAt",
    "createdAt",
  ]) {
    assert.ok(f in fields, `organizations should declare field "${f}"`);
  }
});

test("Phase 1: cleaningCompanies links to an organization (optional)", () => {
  const fields = tables.cleaningCompanies.validator.fields;
  assert.ok(
    "organizationId" in fields,
    "cleaningCompanies should declare an organizationId field",
  );
});
