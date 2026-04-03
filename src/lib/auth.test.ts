import test from "node:test";
import assert from "node:assert/strict";

import {
  canAccessPath,
  getDefaultRouteForRole,
  getRoleFromSessionClaims,
  getRoleFromSessionClaimsOrNull,
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
  assert.equal(
    getRoleFromSessionClaims({ public_metadata: { role: "property_ops" } }),
    "property_ops",
  );
  assert.equal(
    getRoleFromSessionClaims({ unsafe_metadata: { role: "manager" } }),
    "manager",
  );
  assert.equal(
    getRoleFromSessionClaims({
      "https://example.com/custom_claim": { role: "property_ops" },
    }),
    "property_ops",
  );
});

test("getRoleFromSessionClaims uses NEXT_PUBLIC_DEFAULT_ROLE for missing or invalid claims", () => {
  process.env.NEXT_PUBLIC_DEFAULT_ROLE = "cleaner";

  assert.equal(getRoleFromSessionClaims(null), "cleaner");
  assert.equal(getRoleFromSessionClaims({ role: "invalid-role" }), "cleaner");

  process.env.NEXT_PUBLIC_DEFAULT_ROLE = "property_ops";
  assert.equal(getRoleFromSessionClaims(undefined), "property_ops");

  process.env.NEXT_PUBLIC_DEFAULT_ROLE = "admin";
  assert.equal(getRoleFromSessionClaims(undefined), "manager");

  delete process.env.NEXT_PUBLIC_DEFAULT_ROLE;
  assert.equal(getRoleFromSessionClaims(undefined), "manager");
});

test("getRoleFromSessionClaimsOrNull returns null when role is unavailable", () => {
  assert.equal(getRoleFromSessionClaimsOrNull(undefined), null);
  assert.equal(getRoleFromSessionClaimsOrNull({}), null);
  assert.equal(getRoleFromSessionClaimsOrNull({ role: "invalid-role" }), null);
});

test("canAccessPath enforces route access by role", () => {
  assert.equal(canAccessPath("manager", "/jobs"), true);
  assert.equal(canAccessPath("manager", "/jobs/123"), true);
  assert.equal(canAccessPath("manager", "/review"), true);
  assert.equal(canAccessPath("manager", "/review/jobs/abc"), true);
  assert.equal(canAccessPath("property_ops", "/review"), true);
  assert.equal(canAccessPath("manager", "/schedule"), true);
  assert.equal(canAccessPath("cleaner", "/"), false);
  assert.equal(canAccessPath("cleaner", "/cleaner"), true);
  assert.equal(canAccessPath("cleaner", "/cleaner/jobs/123"), true);
  assert.equal(canAccessPath("cleaner", "/review"), false);
  assert.equal(canAccessPath("cleaner", "/jobs"), false);
  assert.equal(canAccessPath("admin", "/settings"), true);
});

test("getDefaultRouteForRole returns the expected landing page", () => {
  assert.equal(getDefaultRouteForRole("admin"), "/");
  assert.equal(getDefaultRouteForRole("property_ops"), "/schedule");
  assert.equal(getDefaultRouteForRole("manager"), "/jobs");
  assert.equal(getDefaultRouteForRole("cleaner"), "/cleaner");
});
