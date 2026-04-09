import test from "node:test";
import assert from "node:assert/strict";

import { assertReviewerRole, isReviewerRole } from "../../../convex/cleaningJobs/reviewAccess";

test("isReviewerRole accepts property_ops and manager", () => {
  assert.equal(isReviewerRole("property_ops"), true);
  assert.equal(isReviewerRole("manager"), true);
});

test("isReviewerRole rejects cleaner and admin", () => {
  assert.equal(isReviewerRole("cleaner"), false);
  assert.equal(isReviewerRole("admin"), false);
});

test("assertReviewerRole throws for non-reviewer roles", () => {
  assert.doesNotThrow(() => assertReviewerRole("property_ops"));
  assert.doesNotThrow(() => assertReviewerRole("manager"));
  assert.throws(() => assertReviewerRole("cleaner"));
  assert.throws(() => assertReviewerRole("admin"));
});
