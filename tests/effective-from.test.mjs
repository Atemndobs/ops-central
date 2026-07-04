/**
 * First-ever fee-config/owner rows on a property must be active from the
 * property's first activity month, not the onboarding click time —
 * otherwise every pre-onboarding month throws in the fee engine
 * (the 2026-07-04 Tataw "Server Error" bug).
 *
 * Run: node --test tests/effective-from.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { firstEffectiveFromMs } from "../convex/lib/effectiveFrom.ts";

const NOW = Date.UTC(2026, 6, 4, 5, 52); // Jul 4 2026, the real incident time

test("backdates to UTC month-start of earliest check-in", () => {
  const midJune = Date.UTC(2026, 5, 17, 15, 0);
  assert.equal(firstEffectiveFromMs(midJune, NOW), Date.UTC(2026, 5, 1));
});

test("no stays yet → falls back to now", () => {
  assert.equal(firstEffectiveFromMs(null, NOW), NOW);
});

test("check-in exactly at month start stays at month start", () => {
  const jun1 = Date.UTC(2026, 5, 1);
  assert.equal(firstEffectiveFromMs(jun1, NOW), jun1);
});
