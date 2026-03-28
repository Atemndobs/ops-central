import test from "node:test";
import assert from "node:assert/strict";

import {
  JOB_STATUSES,
  STATUS_CLASSNAMES,
  STATUS_LABELS,
  WORKFLOW_STEPS,
  getNextStatus,
} from "./job-status.ts";

test("workflow steps expose the new approval stage without terminal statuses", () => {
  assert.deepEqual(WORKFLOW_STEPS, [
    "scheduled",
    "assigned",
    "in_progress",
    "awaiting_approval",
    "completed",
  ]);
  assert.equal(WORKFLOW_STEPS.includes("rework_required"), false);
  assert.equal(WORKFLOW_STEPS.includes("cancelled"), false);
});

test("all statuses have labels and class names", () => {
  for (const status of JOB_STATUSES) {
    assert.equal(typeof STATUS_LABELS[status], "string");
    assert.equal(typeof STATUS_CLASSNAMES[status], "string");
    assert.notEqual(STATUS_LABELS[status].length, 0);
    assert.notEqual(STATUS_CLASSNAMES[status].length, 0);
  }
});

test("getNextStatus follows the updated operational workflow", () => {
  assert.equal(getNextStatus("scheduled"), "assigned");
  assert.equal(getNextStatus("assigned"), "in_progress");
  assert.equal(getNextStatus("in_progress"), "awaiting_approval");
  assert.equal(getNextStatus("awaiting_approval"), "completed");
  assert.equal(getNextStatus("rework_required"), "in_progress");
  assert.equal(getNextStatus("completed"), null);
  assert.equal(getNextStatus("cancelled"), null);
});
