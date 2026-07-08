import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeStatementForPeriod,
  intersectionDays,
  monthRange,
  pickFeeConfigForPeriod,
  resolveCostItemAmount,
  round2,
  type FeeEngineInputs,
} from "./feeEngine.ts";

// ─── Helpers ────────────────────────────────────────────────────────────────

const PROP = "prop_test" as any;
const USER_A = "user_a" as any;
const USER_B = "user_b" as any;
const OWNER_A = "owner_a" as any;
const OWNER_B = "owner_b" as any;
const FC_1 = "fc_1" as any;
const CAT_CLEAN = "cat_clean" as any;
const CAT_PLATFORM = "cat_platform" as any;
const CAT_UTIL = "cat_util" as any;

const MAY_2026 = monthRange("2026-05");

function emptyInputs(overrides: Partial<FeeEngineInputs> = {}): FeeEngineInputs {
  return {
    propertyId: PROP,
    periodStart: MAY_2026.start,
    periodEnd: MAY_2026.end,
    stays: [],
    costItems: [],
    costCategories: [
      { _id: CAT_CLEAN, bucket: "cleaning" },
      { _id: CAT_PLATFORM, bucket: "platformFees" },
      { _id: CAT_UTIL, bucket: "utilities" },
    ],
    manualAdjustments: [],
    capitalExpenditures: [],
    owners: [
      {
        _id: OWNER_A,
        userId: USER_A,
        stakePct: 1.0,
        isPrimaryApprover: true,
        effectiveFrom: 0,
      },
    ],
    feeConfigs: [
      {
        _id: FC_1,
        feePct: 0.2,
        feeBase: "netRevenue",
        effectiveFrom: 0,
      },
    ],
    monthlySettings: [],
    ...overrides,
  };
}

// ─── Pure helpers ───────────────────────────────────────────────────────────

test("round2 rounds to 2 decimal places", () => {
  // Note: 1.005 cannot be represented exactly in IEEE 754 (it's 1.00499999...)
  // so round2(1.005) returns 1.00. This is fine for our money use case because
  // we always round sums-of-monetary-values, not arbitrary halves.
  assert.equal(round2(1.235), 1.24);
  assert.equal(round2(1.234), 1.23);
  assert.equal(round2(1.0), 1.0);
  assert.equal(round2(0), 0);
});

test("monthRange returns UTC start/end exclusive", () => {
  const r = monthRange("2026-02");
  assert.equal(new Date(r.start).toISOString(), "2026-02-01T00:00:00.000Z");
  assert.equal(new Date(r.end).toISOString(), "2026-03-01T00:00:00.000Z");
});

test("intersectionDays handles disjoint, overlapping, and contained ranges", () => {
  const a = monthRange("2026-05"); // 31 days
  assert.equal(intersectionDays(a.start, a.end, a.start, a.end), 31);
  assert.equal(intersectionDays(a.start, a.end, a.end, a.end + 1), 0);
  assert.equal(
    intersectionDays(
      a.start,
      a.end,
      a.start + 10 * 86400000,
      a.start + 20 * 86400000,
    ),
    10,
  );
});

test("pickFeeConfigForPeriod throws if none active at periodStart", () => {
  assert.throws(() =>
    pickFeeConfigForPeriod(
      [{ _id: FC_1, feePct: 0.2, feeBase: "netRevenue", effectiveFrom: MAY_2026.end + 1 }],
      MAY_2026.start,
    ),
  );
});

test("pickFeeConfigForPeriod uses most-recent effectiveFrom on overlap", () => {
  const cfg = pickFeeConfigForPeriod(
    [
      { _id: "fc_old" as any, feePct: 0.15, feeBase: "netRevenue", effectiveFrom: 0 },
      { _id: "fc_new" as any, feePct: 0.2, feeBase: "netRevenue", effectiveFrom: 1000 },
    ],
    2000,
  );
  assert.equal(cfg._id, "fc_new");
  assert.equal(cfg.feePct, 0.2);
});

test("resolveCostItemAmount: monthly over full calendar month ≈ amount × 1", () => {
  const v = resolveCostItemAmount(
    {
      _id: "i1" as any,
      propertyId: PROP,
      categoryId: CAT_UTIL,
      amount: 100,
      frequency: "monthly",
      isActive: true,
    },
    MAY_2026.start,
    MAY_2026.end,
    0,
    [],
  );
  // 31 days / 30.44 ≈ 1.0184
  assert.ok(Math.abs(v - 101.84) < 0.5, `expected ~100, got ${v}`);
});

test("resolveCostItemAmount: revenue_percentage uses grossRevenue", () => {
  const v = resolveCostItemAmount(
    {
      _id: "i2" as any,
      propertyId: PROP,
      categoryId: CAT_PLATFORM,
      amount: 0,
      frequency: "revenue_percentage",
      percentageRate: 0.15,
      isActive: true,
    },
    MAY_2026.start,
    MAY_2026.end,
    1000,
    [],
  );
  assert.equal(v, 150);
});

test("resolveCostItemAmount: per_booking excludes cancelled stays via filtering upstream", () => {
  // Engine passes already-filtered (non-cancelled) stays. So all stays passed here count.
  const v = resolveCostItemAmount(
    {
      _id: "i3" as any,
      propertyId: PROP,
      categoryId: CAT_CLEAN,
      amount: 50,
      frequency: "per_booking",
      isActive: true,
    },
    MAY_2026.start,
    MAY_2026.end,
    0,
    [
      { _id: "s1" as any, propertyId: PROP, checkInAt: MAY_2026.start + 1 },
      { _id: "s2" as any, propertyId: PROP, checkInAt: MAY_2026.start + 100 },
    ],
  );
  assert.equal(v, 100);
});

// ─── Engine end-to-end ──────────────────────────────────────────────────────

test("computeStatementForPeriod: empty → all zeros", () => {
  const out = computeStatementForPeriod(emptyInputs());
  assert.equal(out.totals.grossRevenue, 0);
  assert.equal(out.totals.mgmtFee, 0);
  assert.equal(out.totals.ownerPayout, 0);
  assert.equal(out.totals.perOwner.length, 1);
  assert.equal(out.totals.perOwner[0].payout, 0);
  assert.equal(out.sourceRefs.length, 0);
});

test("computeStatementForPeriod: cancelled stay excluded from grossRevenue", () => {
  const out = computeStatementForPeriod(
    emptyInputs({
      stays: [
        {
          _id: "s1" as any,
          propertyId: PROP,
          checkInAt: MAY_2026.start + 86400000,
          totalAmount: 500,
        },
        {
          _id: "s2" as any,
          propertyId: PROP,
          checkInAt: MAY_2026.start + 86400000 * 2,
          totalAmount: 999,
          cancelledAt: MAY_2026.start + 86400000 * 3,
        },
      ],
    }),
  );
  assert.equal(out.totals.grossRevenue, 500);
  assert.equal(
    out.sourceRefs.filter((r) => r.table === "stays").length,
    1,
    "cancelled stay should not appear in sourceRefs",
  );
});

test("computeStatementForPeriod: revenue manualAdjustment adds to grossRevenue", () => {
  const out = computeStatementForPeriod(
    emptyInputs({
      stays: [
        {
          _id: "s1" as any,
          propertyId: PROP,
          checkInAt: MAY_2026.start + 86400000,
          totalAmount: 1000,
        },
      ],
      manualAdjustments: [
        {
          _id: "ma1" as any,
          month: "2026-05",
          propertyId: PROP,
          type: "revenue",
          amount: 200,
          category: "delayed_payout",
        },
      ],
    }),
  );
  assert.equal(out.totals.grossRevenue, 1200);
});

test("computeStatementForPeriod: platformFees subtracted, mgmtFee 20% of netRevenue", () => {
  const out = computeStatementForPeriod(
    emptyInputs({
      stays: [
        {
          _id: "s1" as any,
          propertyId: PROP,
          checkInAt: MAY_2026.start + 86400000,
          totalAmount: 1000,
        },
      ],
      costItems: [
        {
          _id: "ci1" as any,
          propertyId: PROP,
          categoryId: CAT_PLATFORM,
          amount: 0,
          frequency: "revenue_percentage",
          percentageRate: 0.15,
          isActive: true,
        },
      ],
    }),
  );
  // gross = 1000, platformFees = 150, netRev = 850
  // mgmtFee = 850 × 0.2 = 170, NOI = 850 (no operating costs), ownerPayout = 850 - 170 = 680
  assert.equal(out.totals.grossRevenue, 1000);
  assert.equal(out.totals.platformFees, 150);
  assert.equal(out.totals.netRevenue, 850);
  assert.equal(out.totals.mgmtFee, 170);
  assert.equal(out.totals.ownerPayout, 680);
});

test("computeStatementForPeriod: ownerPayout floored at 0 on a loss period", () => {
  const out = computeStatementForPeriod(
    emptyInputs({
      stays: [
        {
          _id: "s1" as any,
          propertyId: PROP,
          checkInAt: MAY_2026.start,
          totalAmount: 100,
        },
      ],
      costItems: [
        {
          _id: "ci1" as any,
          propertyId: PROP,
          categoryId: CAT_UTIL,
          amount: 500,
          frequency: "monthly",
          isActive: true,
        },
      ],
    }),
  );
  assert.ok(out.totals.noi < 0, "NOI should be negative");
  assert.equal(out.totals.ownerPayout, 0, "ownerPayout floored at 0");
});

test("computeStatementForPeriod: stake-rounding residual goes to largest stakeholder", () => {
  // ownerPayout = 100, three owners with stakes 0.34/0.33/0.33 → 34.00/33.00/33.00 = 100 sum
  // Use 1/3 splits which don't round cleanly: 33.3333... → 33.33 each = 99.99, residual 0.01
  const out = computeStatementForPeriod(
    emptyInputs({
      stays: [
        {
          _id: "s1" as any,
          propertyId: PROP,
          checkInAt: MAY_2026.start,
          totalAmount: 124.99,
        },
      ],
      // feePct 0, so ownerPayout = grossRev = 124.99 / netRevenue = same
      feeConfigs: [
        { _id: FC_1, feePct: 0, feeBase: "netRevenue", effectiveFrom: 0 },
      ],
      owners: [
        {
          _id: OWNER_A,
          userId: USER_A,
          stakePct: 0.34,
          isPrimaryApprover: true,
          effectiveFrom: 0,
        },
        {
          _id: OWNER_B,
          userId: USER_B,
          stakePct: 0.33,
          isPrimaryApprover: false,
          effectiveFrom: 0,
        },
        {
          _id: "owner_c" as any,
          userId: "user_c" as any,
          stakePct: 0.33,
          isPrimaryApprover: false,
          effectiveFrom: 0,
        },
      ],
    }),
  );
  const sum = out.totals.perOwner.reduce((s, p) => s + p.payout, 0);
  assert.equal(
    round2(sum),
    out.totals.ownerPayout,
    "perOwner sum must equal ownerPayout exactly",
  );
  // Largest stake (0.34) gets the residual
  const largest = out.totals.perOwner.find((p) => p.ownerId === OWNER_A)!;
  const others = out.totals.perOwner.filter((p) => p.ownerId !== OWNER_A);
  for (const o of others) {
    assert.ok(largest.payout >= o.payout, "largest stake should hold residual");
  }
});

test("computeStatementForPeriod: throws if stakes don't sum to 1.0", () => {
  assert.throws(() =>
    computeStatementForPeriod(
      emptyInputs({
        owners: [
          {
            _id: OWNER_A,
            userId: USER_A,
            stakePct: 0.5,
            isPrimaryApprover: true,
            effectiveFrom: 0,
          },
        ],
      }),
    ),
  );
});

test("computeStatementForPeriod: feeBase=grossRevenue charges fee on gross even when costs exist", () => {
  const out = computeStatementForPeriod(
    emptyInputs({
      stays: [
        {
          _id: "s1" as any,
          propertyId: PROP,
          checkInAt: MAY_2026.start,
          totalAmount: 1000,
        },
      ],
      costItems: [
        {
          _id: "ci1" as any,
          propertyId: PROP,
          categoryId: CAT_UTIL,
          amount: 200,
          frequency: "monthly",
          isActive: true,
        },
      ],
      feeConfigs: [
        { _id: FC_1, feePct: 0.2, feeBase: "grossRevenue", effectiveFrom: 0 },
      ],
    }),
  );
  assert.equal(out.totals.mgmtFee, 200, "20% of gross 1000 = 200");
});

test("computeStatementForPeriod: capEx is memo-only — does not reduce ownerPayout", () => {
  const out = computeStatementForPeriod(
    emptyInputs({
      stays: [
        {
          _id: "s1" as any,
          propertyId: PROP,
          checkInAt: MAY_2026.start,
          totalAmount: 1000,
        },
      ],
      capitalExpenditures: [
        {
          _id: "cap1" as any,
          propertyId: PROP,
          amount: 5000,
          purchaseDate: MAY_2026.start + 86400000,
        },
      ],
    }),
  );
  assert.equal(out.totals.capExMemo, 5000);
  assert.equal(out.totals.operatingCosts, 0);
  assert.equal(out.totals.ownerPayout, 800); // 1000 * (1 - 0.2)
});
