import { test } from "node:test";
import assert from "node:assert/strict";
import {
  monthlyEquivalent,
  bucketize,
  buildPortfolioReport,
  buildImportedActual,
  inferBucket,
  type CostLineInput,
  type CostContext,
  type PropertyMonthInput,
} from "./costMath.ts";

// jest's toBeCloseTo(value, numDigits): pass if |a-b| < 0.5 * 10^-numDigits.
function closeTo(actual: number, expected: number, numDigits = 2) {
  const ok = Math.abs(actual - expected) < 0.5 * Math.pow(10, -numDigits);
  assert.ok(
    ok,
    `expected ${actual} to be close to ${expected} (±${0.5 * Math.pow(10, -numDigits)})`,
  );
}

const ctx: CostContext = { bookingCount: 3, grossRevenue: 5000 };
const line = (over: Partial<CostLineInput>): CostLineInput => ({
  amount: 0,
  frequency: "monthly",
  ...over,
});

test("monthlyEquivalent — frequency conversions", () => {
  assert.equal(monthlyEquivalent(line({ amount: 1950, frequency: "monthly" }), ctx), 1950);
  assert.equal(monthlyEquivalent(line({ amount: 300, frequency: "quarterly" }), ctx), 100);
  assert.equal(monthlyEquivalent(line({ amount: 1200, frequency: "annual" }), ctx), 100);
  assert.equal(monthlyEquivalent(line({ amount: 1200, frequency: "yearly" }), ctx), 100);
  assert.equal(monthlyEquivalent(line({ amount: 999, frequency: "one_time" }), ctx), 0);
  // per_booking multiplies by BOOKINGS, not nights (B13): $150 × 3 = 450
  assert.equal(monthlyEquivalent(line({ amount: 150, frequency: "per_booking" }), ctx), 450);
  assert.equal(
    monthlyEquivalent(line({ amount: 150, frequency: "per_booking" }), { ...ctx, bookingCount: 0 }),
    0,
  );
  // revenue_percentage uses percentageRate, not amount (B14): 3% of 5000 = 150
  assert.equal(
    monthlyEquivalent(line({ amount: 0, frequency: "revenue_percentage", percentageRate: 3 }), ctx),
    150,
  );
  assert.equal(monthlyEquivalent(line({ amount: 0, frequency: "revenue_percentage" }), ctx), 0);
});

test("bucketize — routes itemBucket → categoryBucket → keyword → other", () => {
  const c = { bookingCount: 2, grossRevenue: 3000 };
  const { bucketTotals, total } = bucketize(
    [
      { amount: 1950, frequency: "monthly", itemBucket: "lease" },
      { amount: 150, frequency: "per_booking", itemBucket: "cleaning" }, // 150*2=300
      { amount: 280, frequency: "monthly", categoryBucket: "utilities" },
      { amount: 99, frequency: "monthly" }, // no bucket, no name → other
    ],
    c,
  );
  assert.equal(bucketTotals.lease, 1950);
  assert.equal(bucketTotals.cleaning, 300);
  assert.equal(bucketTotals.utilities, 280);
  assert.equal(bucketTotals.other, 99);
  assert.equal(bucketTotals.unassigned, 0);
  assert.equal(total, 1950 + 300 + 280 + 99);
});

test("bucketize — empty returns all-zero buckets", () => {
  const { bucketTotals, total } = bucketize([], { bookingCount: 2, grossRevenue: 3000 });
  assert.equal(total, 0);
  assert.equal(bucketTotals.cleaning, 0);
});

// ─── June 2026 golden (reports/2026/june/portfolio_june_2026.csv) ─────────────
test("buildPortfolioReport — June 2026 golden", () => {
  const active = (id: string, name: string, rev: number, cost: number): PropertyMonthInput => ({
    id,
    name,
    status: "active",
    revenueGross: rev,
    revenueNet: rev,
    bookingCount: 1,
    hasData: true,
    lines: [{ amount: cost, frequency: "monthly", itemBucket: "other" }],
  });
  const props: PropertyMonthInput[] = [
    active("p1", "Houston-The Lisboa", 5574.63, 3473.33),
    active("p2", "Dallas-The Andaluz", 3539, 2888.33),
    active("p3", "Tucson-Little Sierra", 1700, 1553.33),
    active("p4", "Dallas-The Paris", 3160, 2898.33),
    active("p5", "Austin-Little Skagen", 1466, 2063.33),
    { id: "p6", name: "Dallas-The Scandi", status: "dropped", revenueGross: 9999, revenueNet: 9999, bookingCount: 0, hasData: true, lines: [{ amount: 9999, frequency: "monthly" }] },
    { id: "p7", name: "Phoenix-3BR", status: "managed", revenueGross: 3338, revenueNet: 3338, bookingCount: 0, hasData: true, lines: [{ amount: 3683.33, frequency: "monthly" }] },
  ];

  const r = buildPortfolioReport("2026-06", props);

  // excludes dropped + managed
  assert.deepEqual(
    r.rows.map((x) => x.name).sort(),
    ["Austin-Little Skagen", "Dallas-The Andaluz", "Dallas-The Paris", "Houston-The Lisboa", "Tucson-Little Sierra"],
  );
  assert.deepEqual(r.excluded.map((x) => x.name).sort(), ["Dallas-The Scandi", "Phoenix-3BR"]);

  // portfolio totals from the accepted CSV
  closeTo(r.revenueGross, 15439.63, 2);
  closeTo(r.totalCosts, 12876.65, 2);
  closeTo(r.netProfit, 2562.98, 2);
  closeTo(r.marginPercent!, 16.6, 1);

  // per-property net + margin — Lisboa +$2,101
  const lisboa = r.rows.find((x) => x.name === "Houston-The Lisboa")!;
  closeTo(lisboa.net, 2101.3, 2);
  closeTo(lisboa.marginPercent!, 37.69, 1);
});

test("buildPortfolioReport — variable-cost paths flow through at portfolio level", () => {
  const props: PropertyMonthInput[] = [
    {
      id: "x",
      name: "Test-Unit",
      status: "active",
      revenueGross: 4000,
      revenueNet: 4000,
      bookingCount: 3,
      hasData: true,
      lines: [
        { amount: 1950, frequency: "monthly", itemBucket: "lease" },
        { amount: 150, frequency: "per_booking", itemBucket: "cleaning" }, // 150 × 3 = 450
        { amount: 0, frequency: "revenue_percentage", percentageRate: 3, itemBucket: "payouts" }, // 3% × 4000 = 120
      ],
    },
  ];
  const r = buildPortfolioReport("2026-06", props);
  closeTo(r.totalCosts, 2520, 2);
  closeTo(r.rows[0].bucketTotals.cleaning, 450, 2);
  closeTo(r.rows[0].bucketTotals.payouts, 120, 2);
  closeTo(r.netProfit, 1480, 2);
});

test("buildPortfolioReport — no-data rows flagged and excluded from totals", () => {
  const props: PropertyMonthInput[] = [
    { id: "a", name: "Has-Data-Unit", status: "active", revenueGross: 1000, revenueNet: 1000, bookingCount: 2, hasData: true, lines: [{ amount: 600, frequency: "monthly", itemBucket: "lease" }] },
    { id: "b", name: "No-Data-Unit", status: "active", revenueGross: 0, revenueNet: 0, bookingCount: 0, hasData: false, lines: [{ amount: 500, frequency: "monthly", itemBucket: "lease" }] },
  ];
  const r = buildPortfolioReport("2026-06", props);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows.find((row) => row.id === "b")!.hasData, false);
  assert.equal(r.rows.find((row) => row.id === "a")!.hasData, true);
  closeTo(r.revenueGross, 1000, 2);
  closeTo(r.totalCosts, 600, 2);
  closeTo(r.netProfit, 400, 2);
});

test("buildImportedActual — complete actual from imported revenue/bookings + cost lines", () => {
  const costLines: CostLineInput[] = [
    { amount: 1950, frequency: "monthly", itemBucket: "lease" },
    { amount: 150, frequency: "per_booking", itemBucket: "cleaning" },
    { amount: 0, frequency: "revenue_percentage", percentageRate: 3, itemBucket: "payouts" },
  ];
  const r = buildImportedActual({ grossRevenue: 4000, bookingCount: 3, bookedNights: 21, costLines });
  assert.equal(r.grossRevenue, 4000);
  assert.equal(r.platformFees, 0);
  assert.equal(r.netRevenue, 4000);
  assert.equal(r.totalBookings, 3);
  assert.equal(r.bookedNights, 21);
  closeTo(r.totalCosts, 2520, 2);
  closeTo(r.netProfit, 1480, 2);
  closeTo(r.marginPercent!, 37, 2);
  assert.equal(r.isActual, true);

  const zero = buildImportedActual({ grossRevenue: 0, bookingCount: 0, bookedNights: 0, costLines: [] });
  assert.equal(zero.marginPercent, null);
  assert.equal(zero.totalCosts, 0);
});

test("inferBucket — keyword regex fallback", () => {
  assert.equal(inferBucket("Monthly Subscription"), "subscriptions");
  assert.equal(inferBucket("ChatGPT Plus subscription"), "subscriptions");
  assert.equal(inferBucket("City of Austin Utilities"), "utilities");
  assert.equal(inferBucket("Electric bill"), "utilities");
  assert.equal(inferBucket("Internet / WiFi"), "utilities");
  assert.equal(inferBucket("Rent / Lease"), "lease");
  assert.equal(inferBucket("Mortgage payment"), "lease");
  assert.equal(inferBucket("Cleaning fee"), "cleaning");
  assert.equal(inferBucket("Deep clean"), "cleaning");
  assert.equal(inferBucket("VA payout"), "payouts");
  assert.equal(inferBucket("Virtual assistant salary"), "payouts");
  assert.equal(inferBucket("Payroll run"), "payouts");
  assert.equal(inferBucket("Random thing"), "other");
  assert.equal(inferBucket("Office supplies"), "other");
  assert.equal(inferBucket(null), "other");
  assert.equal(inferBucket(undefined), "other");
  assert.equal(inferBucket(""), "other");
});

test("bucketize — keyword-inference fallback (subscriptions never unassigned)", () => {
  const c = { bookingCount: 1, grossRevenue: 2000 };
  assert.equal(
    bucketize([{ amount: 20, frequency: "monthly", itemBucket: null, categoryBucket: null, name: "Monthly Subscription" }], c)
      .bucketTotals.subscriptions,
    20,
  );
  assert.equal(
    bucketize([{ amount: 432, frequency: "monthly", itemBucket: null, categoryBucket: null, name: "ChatGPT Plus", categoryName: "Subscriptions" }], c)
      .bucketTotals.subscriptions,
    432,
  );
  assert.equal(
    bucketize([{ amount: 55, frequency: "monthly", itemBucket: null, categoryBucket: null }], c).bucketTotals.other,
    55,
  );
  // itemBucket still wins over keyword
  assert.equal(
    bucketize([{ amount: 100, frequency: "monthly", itemBucket: "payouts", name: "Monthly Subscription" }], c)
      .bucketTotals.payouts,
    100,
  );
  // categoryBucket wins over name keyword
  assert.equal(
    bucketize([{ amount: 75, frequency: "monthly", itemBucket: null, categoryBucket: "utilities", name: "Monthly Subscription" }], c)
      .bucketTotals.utilities,
    75,
  );
});
