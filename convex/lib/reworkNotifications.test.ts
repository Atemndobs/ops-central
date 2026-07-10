import { test } from "node:test";
import assert from "node:assert/strict";
import { CLEANER_REWORK_DISMISSAL_TYPES } from "./reworkNotifications.ts";

// Regression guard for the "rejection never reaches the cleaner" bug: a rework
// transition creates a `rework_required` alert AND (in the deferred side-effect)
// dismisses a batch of cleaner notification types. If that batch ever contains
// `rework_required` again, it deletes the alert it just created.
test("cleaner rework-dismissal never clears the rework_required alert it creates", () => {
  assert.ok(
    !(CLEANER_REWORK_DISMISSAL_TYPES as readonly string[]).includes(
      "rework_required",
    ),
    "CLEANER_REWORK_DISMISSAL_TYPES must not include 'rework_required'",
  );
});

test("cleaner rework-dismissal still clears stale assignment + completion alerts", () => {
  const types = CLEANER_REWORK_DISMISSAL_TYPES as readonly string[];
  assert.ok(types.includes("job_assigned"));
  assert.ok(types.includes("job_completed"));
});
