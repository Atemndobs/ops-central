import test from "node:test";
import assert from "node:assert/strict";

import { assertReviewerRole, isReviewerRole } from "../../../convex/cleaningJobs/reviewAccess";

// Per R7.4 (manager-scope task, 2026-05-17): approval = admin + property_ops.
// Managers and cleaners are rejected.

test("isReviewerRole accepts admin and property_ops", () => {
  assert.equal(isReviewerRole("admin"), true);
  assert.equal(isReviewerRole("property_ops"), true);
});

test("isReviewerRole rejects manager and cleaner", () => {
  assert.equal(isReviewerRole("manager"), false);
  assert.equal(isReviewerRole("cleaner"), false);
});

test("assertReviewerRole throws for non-reviewer roles", () => {
  assert.doesNotThrow(() => assertReviewerRole("admin"));
  assert.doesNotThrow(() => assertReviewerRole("property_ops"));
  assert.throws(() => assertReviewerRole("manager"));
  assert.throws(() => assertReviewerRole("cleaner"));
});
