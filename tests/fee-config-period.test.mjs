/**
 * Pins the fee-engine contract that getOwnerStatementDraft's error
 * envelope (and Task 3's first-config backdating) depend on:
 *   - no config active at periodStart → throws (message names the ms)
 *   - a backdated config covers later periods until effectiveTo
 *
 * Run: node --test tests/fee-config-period.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickFeeConfigForPeriod } from "../convex/owner/feeEngine.ts";

const JAN_1_2026 = Date.UTC(2026, 0, 1);
const JUN_1_2026 = Date.UTC(2026, 5, 1);
const JUL_4_2026 = Date.UTC(2026, 6, 4);

const cfg = (overrides) => ({
  _id: "gh7test",
  propertyId: "rs7test",
  feePct: 0.2,
  feeBase: "netRevenue",
  approvalThreshold: 500,
  effectiveFrom: JAN_1_2026,
  effectiveTo: undefined,
  ...overrides,
});

test("throws when the only config starts after periodStart (Tataw bug)", () => {
  assert.throws(
    () => pickFeeConfigForPeriod([cfg({ effectiveFrom: JUL_4_2026 })], JUN_1_2026),
    /No propertyFeeConfig active at periodStart=/,
  );
});

test("backdated config is active for later months", () => {
  const picked = pickFeeConfigForPeriod([cfg()], JUN_1_2026);
  assert.equal(picked.effectiveFrom, JAN_1_2026);
});

test("closed config (effectiveTo <= periodStart) is not active", () => {
  assert.throws(
    () => pickFeeConfigForPeriod([cfg({ effectiveTo: JUN_1_2026 })], JUN_1_2026),
    /No propertyFeeConfig active/,
  );
});
