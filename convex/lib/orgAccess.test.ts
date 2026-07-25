import test from "node:test";
import assert from "node:assert/strict";

import {
  assertOrganizationAccess,
  isSameOrganization,
} from "./orgAccess.ts";
import type { Id } from "../_generated/dataModel";

// Cast helpers: the pure logic only compares ids by value.
const orgA = "org_a" as Id<"organizations">;
const orgB = "org_b" as Id<"organizations">;

test("isSameOrganization compares ids by value, treating null/undefined alike", () => {
  assert.equal(isSameOrganization(orgA, orgA), true);
  assert.equal(isSameOrganization(orgA, orgB), false);
  assert.equal(isSameOrganization(undefined, null), true);
  assert.equal(isSameOrganization(orgA, undefined), false);
});

test("ISOLATION: caller cannot access another org's resource when enforced", () => {
  assert.throws(
    () =>
      assertOrganizationAccess({
        enforced: true,
        callerOrgId: orgA,
        resourceOrgId: orgB,
      }),
    /Cross-organization access denied/,
    "org A must not reach org B's resource under enforcement",
  );
});

test("same-org access is allowed when enforced", () => {
  assert.doesNotThrow(() =>
    assertOrganizationAccess({
      enforced: true,
      callerOrgId: orgA,
      resourceOrgId: orgA,
    }),
  );
});

test("flag OFF is a full no-op even across different orgs", () => {
  assert.doesNotThrow(() =>
    assertOrganizationAccess({
      enforced: false,
      callerOrgId: orgA,
      resourceOrgId: orgB,
    }),
  );
});

test("missing org id is allowed (legacy/partial-backfill rollout safety)", () => {
  assert.doesNotThrow(() =>
    assertOrganizationAccess({
      enforced: true,
      callerOrgId: orgA,
      resourceOrgId: undefined,
    }),
  );
  assert.doesNotThrow(() =>
    assertOrganizationAccess({
      enforced: true,
      callerOrgId: null,
      resourceOrgId: orgB,
    }),
  );
});
