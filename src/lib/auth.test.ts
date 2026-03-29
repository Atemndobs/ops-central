import test from "node:test";
import assert from "node:assert/strict";

import {
  canAccessPath,
  getDefaultRouteForRole,
  getRoleFromSessionClaims,
} from "./auth.ts";

test("getRoleFromSessionClaims prefers direct role claims", () => {
  process.env.NEXT_PUBLIC_DEFAULT_ROLE = "cleaner";

  const role = getRoleFromSessionClaims({
    role: "manager",
    metadata: { role: "admin" },
  });

  assert.equal(role, "manager");
});

test("getRoleFromSessionClaims falls back through metadata sources", () => {
  process.env.NEXT_PUBLIC_DEFAULT_ROLE = "cleaner";

  assert.equal(
    getRoleFromSessionClaims({ metadata: { role: "property_ops" } }),
    "property_ops",
  );
  assert.equal(
    getRoleFromSessionClaims({ publicMetadata: { role: "manager" } }),
    "manager",
  );
  assert.equal(
    getRoleFromSessionClaims({ unsafeMetadata: { role: "admin" } }),
    "admin",
  );
});

test("getRoleFromSessionClaims uses NEXT_PUBLIC_DEFAULT_ROLE for missing or invalid claims", () => {
  process.env.NEXT_PUBLIC_DEFAULT_ROLE = "cleaner";

  assert.equal(getRoleFromSessionClaims(null), "cleaner");
  assert.equal(getRoleFromSessionClaims({ role: "invalid-role" }), "cleaner");

  delete process.env.NEXT_PUBLIC_DEFAULT_ROLE;
  assert.equal(getRoleFromSessionClaims(undefined), "admin");
});

test("canAccessPath enforces route access by role", () => {
  assert.equal(canAccessPath("manager", "/jobs"), true);
  assert.equal(canAccessPath("manager", "/jobs/123"), true);
  assert.equal(canAccessPath("manager", "/schedule"), false);
  assert.equal(canAccessPath("cleaner", "/"), false);
  assert.equal(canAccessPath("cleaner", "/cleaner"), true);
  assert.equal(canAccessPath("cleaner", "/cleaner/jobs/123"), true);
  assert.equal(canAccessPath("cleaner", "/jobs"), false);
  assert.equal(canAccessPath("admin", "/settings"), true);
});

test("getDefaultRouteForRole returns the expected landing page", () => {
  assert.equal(getDefaultRouteForRole("admin"), "/");
  assert.equal(getDefaultRouteForRole("property_ops"), "/schedule");
  assert.equal(getDefaultRouteForRole("manager"), "/jobs");
  assert.equal(getDefaultRouteForRole("cleaner"), "/cleaner");
});
