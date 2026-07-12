import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_REWORK_DEADLINE_MINUTES,
  resolveReworkDeadlineMinutes,
  computeReworkDueAt,
} from "./reworkDeadline.ts";

test("per-property override wins over org default", () => {
  assert.equal(resolveReworkDeadlineMinutes(45, 20), 45);
});

test("org default used when no property override", () => {
  assert.equal(resolveReworkDeadlineMinutes(undefined, 20), 20);
  assert.equal(resolveReworkDeadlineMinutes(null, 20), 20);
});

test("falls back to 30 when neither is set", () => {
  assert.equal(resolveReworkDeadlineMinutes(undefined, undefined), 30);
  assert.equal(DEFAULT_REWORK_DEADLINE_MINUTES, 30);
});

test("ignores non-positive / non-finite config and falls through", () => {
  assert.equal(resolveReworkDeadlineMinutes(0, 20), 20);
  assert.equal(resolveReworkDeadlineMinutes(-5, 20), 20);
  assert.equal(resolveReworkDeadlineMinutes(Number.NaN, undefined), 30);
  assert.equal(resolveReworkDeadlineMinutes(0, 0), 30);
});

test("computeReworkDueAt adds resolved minutes to the rejection time", () => {
  const rejectedAt = 1_000_000;
  assert.equal(computeReworkDueAt(rejectedAt, 45, 20), rejectedAt + 45 * 60_000);
  assert.equal(
    computeReworkDueAt(rejectedAt, undefined, undefined),
    rejectedAt + 30 * 60_000,
  );
});
