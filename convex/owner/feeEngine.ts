// Pure fee-engine. Given a snapshot of the relevant tables for a period, returns
// the full statement totals + the `sourceRefs` audit trail. No db access — the
// caller (query or mutation) loads data, calls this, and writes the snapshot.
//
// Designed to be cheap to unit-test: every input is a plain array, every output
// is deterministic. The mutation that issues a statement re-loads inputs and
// re-runs this inside the mutation transaction for TOCTOU safety.
//
// Spec §5 + §5.1 + §5.2. Trust rules (immutability, time-versioning, live drafts)
// are enforced by the CALLER, not by this function.

import type { Id } from "../_generated/dataModel";
import type { Bucket } from "./constants";

// ─── Input types ────────────────────────────────────────────────────────────

export type FeeBase = "grossRevenue" | "netRevenue" | "netOperatingProfit";

export interface FeeEngineStay {
  _id: Id<"stays">;
  propertyId: Id<"properties">;
  checkInAt: number;
  totalAmount?: number;
  cancelledAt?: number;
}

export interface FeeEnginePropertyCostItem {
  _id: Id<"propertyCostItems">;
  propertyId: Id<"properties">;
  categoryId: Id<"costCategories">;
  amount: number;
  frequency:
    | "one_time"
    | "monthly"
    | "quarterly"
    | "annual"
    | "yearly"
    | "per_booking"
    | "revenue_percentage";
  percentageRate?: number;
  startDate?: number;
  endDate?: number;
  isActive: boolean;
}

export interface FeeEngineCostCategory {
  _id: Id<"costCategories">;
  bucket: Bucket;
}

export interface FeeEngineManualAdjustment {
  _id: Id<"manualAdjustments">;
  month: string; // "YYYY-MM"
  propertyId?: Id<"properties">;
  type: "revenue" | "expense" | "cash";
  amount: number;
  category: string;
}

export interface FeeEngineCapEx {
  _id: Id<"capitalExpenditures">;
  propertyId: Id<"properties">;
  amount: number;
  purchaseDate: number;
}

export interface FeeEnginePropertyOwner {
  _id: Id<"propertyOwners">;
  userId: Id<"users">;
  stakePct: number;
  isPrimaryApprover: boolean;
  effectiveFrom: number;
  effectiveTo?: number;
}

export interface FeeEngineFeeConfig {
  _id: Id<"propertyFeeConfig">;
  feePct: number;
  feeBase: FeeBase;
  effectiveFrom: number;
  effectiveTo?: number;
}

export interface FeeEnginePropertyMonthlySettings {
  month: string;
  settings: {
    cleaningModel?: "percent" | "flat_cap";
    cleaningPercent?: number;
    cleaningFlatCap?: number;
    utilitiesOverride?: number;
    customCosts?: Array<{ name: string; amount: number }>;
  };
}

export interface FeeEngineInputs {
  propertyId: Id<"properties">;
  periodStart: number; // inclusive
  periodEnd: number; // exclusive
  stays: FeeEngineStay[];
  costItems: FeeEnginePropertyCostItem[];
  costCategories: FeeEngineCostCategory[];
  manualAdjustments: FeeEngineManualAdjustment[];
  capitalExpenditures: FeeEngineCapEx[];
  owners: FeeEnginePropertyOwner[];
  feeConfigs: FeeEngineFeeConfig[];
  monthlySettings: FeeEnginePropertyMonthlySettings[];
}

// ─── Output types ───────────────────────────────────────────────────────────

export type SourceRef =
  | {
      table: "propertyCostItems";
      rowId: Id<"propertyCostItems">;
      amount: number;
      bucket: string;
    }
  | {
      table: "manualAdjustments";
      rowId: Id<"manualAdjustments">;
      amount: number;
      bucket?: string;
    }
  | { table: "stays"; rowId: Id<"stays">; amount: number }
  | {
      table: "capitalExpenditures";
      rowId: Id<"capitalExpenditures">;
      amount: number;
    };

export interface PerOwnerPayout {
  ownerId: Id<"propertyOwners">;
  userId: Id<"users">;
  stakePct: number;
  payout: number;
}

export interface StatementTotals {
  grossRevenue: number;
  platformFees: number;
  netRevenue: number;
  costsByBucket: Array<{ bucket: string; amount: number }>;
  operatingCosts: number;
  noi: number;
  feeBase: FeeBase;
  feePct: number;
  mgmtFee: number;
  ownerPayout: number;
  capExMemo: number;
  perOwner: PerOwnerPayout[];
}

export interface FeeConfigSnapshot {
  feeConfigId: Id<"propertyFeeConfig">;
  feePct: number;
  feeBase: string;
  effectiveFrom: number;
}

export interface FeeEngineOutput {
  totals: StatementTotals;
  feeConfigSnapshot: FeeConfigSnapshot;
  sourceRefs: SourceRef[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Round to 2 decimal places (cents). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Parse "YYYY-MM" → [start, end) in unix ms, UTC. */
export function monthRange(month: string): { start: number; end: number } {
  const [y, m] = month.split("-").map(Number);
  const start = Date.UTC(y, m - 1, 1);
  const end = Date.UTC(y, m, 1);
  return { start, end };
}

/** Duration in days of intersection between two unix-ms ranges, clamped at 0. */
export function intersectionDays(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): number {
  const start = Math.max(aStart, bStart);
  const end = Math.min(aEnd, bEnd);
  if (end <= start) return 0;
  return (end - start) / (1000 * 60 * 60 * 24);
}

/** The propertyFeeConfig row active at `periodStart`. Throws if none. */
export function pickFeeConfigForPeriod(
  configs: FeeEngineFeeConfig[],
  periodStart: number,
): FeeEngineFeeConfig {
  const active = configs.filter(
    (c) =>
      c.effectiveFrom <= periodStart &&
      (c.effectiveTo === undefined || c.effectiveTo > periodStart),
  );
  if (active.length === 0) {
    throw new Error(
      `No propertyFeeConfig active at periodStart=${periodStart}. ` +
        `Onboarding must create one before issuing a statement.`,
    );
  }
  // If multiple overlap (shouldn't happen with proper upsert), pick the most recent.
  active.sort((a, b) => b.effectiveFrom - a.effectiveFrom);
  return active[0];
}

/** Property owners active at `periodStart`. */
export function pickOwnersForPeriod(
  owners: FeeEnginePropertyOwner[],
  periodStart: number,
): FeeEnginePropertyOwner[] {
  return owners.filter(
    (o) =>
      o.effectiveFrom <= periodStart &&
      (o.effectiveTo === undefined || o.effectiveTo > periodStart),
  );
}

/** Resolve a propertyCostItem's contribution to the period. See spec §5.1. */
export function resolveCostItemAmount(
  item: FeeEnginePropertyCostItem,
  periodStart: number,
  periodEnd: number,
  grossRevenue: number,
  staysInPeriod: FeeEngineStay[],
): number {
  if (!item.isActive) return 0;

  const itemStart = item.startDate ?? Number.NEGATIVE_INFINITY;
  const itemEnd = item.endDate ?? Number.POSITIVE_INFINITY;
  const dI = intersectionDays(
    periodStart,
    periodEnd,
    itemStart === Number.NEGATIVE_INFINITY ? -8.64e15 : itemStart,
    itemEnd === Number.POSITIVE_INFINITY ? 8.64e15 : itemEnd,
  );

  switch (item.frequency) {
    case "one_time":
      // include amount iff startDate ∈ [periodStart, periodEnd)
      if (item.startDate === undefined) return 0;
      return item.startDate >= periodStart && item.startDate < periodEnd
        ? item.amount
        : 0;

    case "monthly":
      return item.amount * (dI / 30.44);

    case "quarterly":
      return item.amount * (dI / 91.25);

    case "annual":
    case "yearly":
      return item.amount * (dI / 365.25);

    case "per_booking": {
      // Count non-cancelled stays whose checkInAt ∈ intersection window.
      const winStart = Math.max(
        periodStart,
        item.startDate ?? Number.NEGATIVE_INFINITY,
      );
      const winEnd = Math.min(
        periodEnd,
        item.endDate ?? Number.POSITIVE_INFINITY,
      );
      const count = staysInPeriod.filter(
        (s) => s.checkInAt >= winStart && s.checkInAt < winEnd,
      ).length;
      return item.amount * count;
    }

    case "revenue_percentage":
      return grossRevenue * (item.percentageRate ?? 0);

    default:
      // Exhaustive — TS catches missing cases.
      return 0;
  }
}

// ─── Main compute function ──────────────────────────────────────────────────

export function computeStatementForPeriod(
  inputs: FeeEngineInputs,
): FeeEngineOutput {
  const {
    propertyId,
    periodStart,
    periodEnd,
    stays,
    costItems,
    costCategories,
    manualAdjustments,
    capitalExpenditures,
    owners,
    feeConfigs,
    monthlySettings,
  } = inputs;

  // Build category → bucket lookup
  const bucketOf = new Map<Id<"costCategories">, Bucket>();
  for (const cat of costCategories) bucketOf.set(cat._id, cat.bucket);

  const sourceRefs: SourceRef[] = [];

  // ── 1. grossRevenue ─────────────────────────────────────────────────────
  const periodStays = stays.filter(
    (s) =>
      s.propertyId === propertyId &&
      s.checkInAt >= periodStart &&
      s.checkInAt < periodEnd &&
      s.cancelledAt === undefined,
  );
  let grossRevenue = 0;
  for (const stay of periodStays) {
    const amt = stay.totalAmount ?? 0;
    grossRevenue += amt;
    sourceRefs.push({ table: "stays", rowId: stay._id, amount: amt });
  }
  // Revenue adjustments add to grossRevenue (spec §5 step 1).
  const periodMonths = monthsTouchingPeriod(periodStart, periodEnd);
  for (const adj of manualAdjustments) {
    if (adj.propertyId !== propertyId) continue;
    if (adj.type !== "revenue") continue;
    if (!periodMonths.has(adj.month)) continue;
    grossRevenue += adj.amount;
    sourceRefs.push({
      table: "manualAdjustments",
      rowId: adj._id,
      amount: adj.amount,
    });
  }

  // ── 2. platformFees ─────────────────────────────────────────────────────
  let platformFees = 0;
  for (const item of costItems) {
    if (item.propertyId !== propertyId) continue;
    const bucket = bucketOf.get(item.categoryId);
    if (bucket !== "platformFees") continue;
    const amt = resolveCostItemAmount(
      item,
      periodStart,
      periodEnd,
      grossRevenue,
      periodStays,
    );
    if (amt === 0) continue;
    platformFees += amt;
    sourceRefs.push({
      table: "propertyCostItems",
      rowId: item._id,
      amount: amt,
      bucket,
    });
  }

  // ── 3. netRevenue ───────────────────────────────────────────────────────
  const netRevenue = grossRevenue - platformFees;

  // ── 4. operatingCosts (everything except platformFees + managementFee + capEx) ──
  // Monthly-settings overrides REPLACE bucket totals per spec §5.1.
  const overrideMonths = new Set(
    monthlySettings
      .filter((s) =>
        Array.from(periodMonths).some((m) => m === s.month),
      )
      .map((s) => s.month),
  );
  // Map of bucket → which months have an override that EXCLUDES the underlying items.
  const cleaningOverriddenMonths = new Set<string>();
  const utilitiesOverriddenMonths = new Set<string>();
  for (const s of monthlySettings) {
    if (!periodMonths.has(s.month)) continue;
    if (s.settings.cleaningModel) cleaningOverriddenMonths.add(s.month);
    if (s.settings.utilitiesOverride !== undefined)
      utilitiesOverriddenMonths.add(s.month);
  }

  const costsByBucket = new Map<Bucket, number>();
  for (const item of costItems) {
    if (item.propertyId !== propertyId) continue;
    const bucket = bucketOf.get(item.categoryId);
    if (!bucket) continue;
    if (bucket === "platformFees" || bucket === "managementFee") continue;
    // If a monthly override REPLACES this bucket for ANY month touched by the
    // period, exclude this item entirely (the override value lands below).
    // Simpler interpretation: for periods spanning multiple months with mixed
    // overrides, the engine errs on the side of the override. v1 deals with
    // calendar-month periods only (spec §13a item 3), so this is one-month-or-none.
    if (bucket === "cleaning" && cleaningOverriddenMonths.size > 0) continue;
    if (bucket === "utilities" && utilitiesOverriddenMonths.size > 0) continue;
    const amt = resolveCostItemAmount(
      item,
      periodStart,
      periodEnd,
      grossRevenue,
      periodStays,
    );
    if (amt === 0) continue;
    costsByBucket.set(bucket, (costsByBucket.get(bucket) ?? 0) + amt);
    sourceRefs.push({
      table: "propertyCostItems",
      rowId: item._id,
      amount: amt,
      bucket,
    });
  }
  // Manual expense adjustments → "other" bucket. Portfolio-level (no propertyId)
  // adjustments are excluded from per-property statements.
  for (const adj of manualAdjustments) {
    if (adj.propertyId !== propertyId) continue;
    if (adj.type !== "expense") continue;
    if (!periodMonths.has(adj.month)) continue;
    costsByBucket.set("other", (costsByBucket.get("other") ?? 0) + adj.amount);
    sourceRefs.push({
      table: "manualAdjustments",
      rowId: adj._id,
      amount: adj.amount,
      bucket: "other",
    });
  }
  // Apply monthly overrides
  for (const s of monthlySettings) {
    if (!periodMonths.has(s.month)) continue;
    const settings = s.settings;
    if (settings.cleaningModel === "percent" && settings.cleaningPercent != null) {
      const v = grossRevenue * settings.cleaningPercent;
      costsByBucket.set(
        "cleaning",
        (costsByBucket.get("cleaning") ?? 0) + v,
      );
    }
    if (settings.cleaningModel === "flat_cap" && settings.cleaningFlatCap != null) {
      // min(sum_of_cleaning_items, cleaningFlatCap) — but we already excluded
      // the items above. So the cap IS the cleaning total for this period.
      // For mixed multi-month periods this approximates; v1 is calendar-month.
      costsByBucket.set("cleaning", settings.cleaningFlatCap);
    }
    if (settings.utilitiesOverride !== undefined) {
      costsByBucket.set("utilities", settings.utilitiesOverride);
    }
    if (settings.customCosts) {
      for (const c of settings.customCosts) {
        costsByBucket.set("other", (costsByBucket.get("other") ?? 0) + c.amount);
      }
    }
  }
  let operatingCosts = 0;
  for (const v of costsByBucket.values()) operatingCosts += v;

  // ── 5. NOI ──────────────────────────────────────────────────────────────
  const noi = netRevenue - operatingCosts;

  // ── 6. feeConfig active at periodStart ──────────────────────────────────
  const feeConfig = pickFeeConfigForPeriod(feeConfigs, periodStart);

  // ── 7. baseValue ────────────────────────────────────────────────────────
  let baseValue: number;
  switch (feeConfig.feeBase) {
    case "grossRevenue":
      baseValue = grossRevenue;
      break;
    case "netRevenue":
      baseValue = netRevenue;
      break;
    case "netOperatingProfit":
      baseValue = noi;
      break;
  }

  // ── 8. mgmtFee = max(0, baseValue) × feePct ─────────────────────────────
  const mgmtFee = Math.max(0, baseValue) * feeConfig.feePct;

  // ── 9. ownerPayout = max(0, NOI − mgmtFee) ──────────────────────────────
  const ownerPayout = Math.max(0, noi - mgmtFee);

  // ── 10. capExMemo (memo only) ───────────────────────────────────────────
  let capExMemo = 0;
  for (const cap of capitalExpenditures) {
    if (cap.propertyId !== propertyId) continue;
    if (cap.purchaseDate < periodStart || cap.purchaseDate >= periodEnd) continue;
    capExMemo += cap.amount;
    sourceRefs.push({
      table: "capitalExpenditures",
      rowId: cap._id,
      amount: cap.amount,
    });
  }

  // ── 11–12. perOwner splits ──────────────────────────────────────────────
  const activeOwners = pickOwnersForPeriod(owners, periodStart);
  const stakeSum = activeOwners.reduce((s, o) => s + o.stakePct, 0);
  if (activeOwners.length > 0 && Math.abs(stakeSum - 1.0) > 0.0001) {
    throw new Error(
      `Active owners for property at periodStart sum stakePct=${stakeSum}; expected 1.0`,
    );
  }
  // Round each share, assign residual to largest stakeholder.
  const perOwner: PerOwnerPayout[] = activeOwners.map((o) => ({
    ownerId: o._id,
    userId: o.userId,
    stakePct: o.stakePct,
    payout: round2(ownerPayout * o.stakePct),
  }));
  if (perOwner.length > 0) {
    const sum = perOwner.reduce((s, p) => s + p.payout, 0);
    const residual = round2(ownerPayout - sum);
    if (residual !== 0) {
      // Largest stake; ties broken by lowest ownerId (deterministic).
      let idx = 0;
      for (let i = 1; i < perOwner.length; i++) {
        if (
          perOwner[i].stakePct > perOwner[idx].stakePct ||
          (perOwner[i].stakePct === perOwner[idx].stakePct &&
            perOwner[i].ownerId < perOwner[idx].ownerId)
        ) {
          idx = i;
        }
      }
      perOwner[idx].payout = round2(perOwner[idx].payout + residual);
    }
  }

  // ── Build output ────────────────────────────────────────────────────────
  const costsByBucketArr = Array.from(costsByBucket.entries()).map(
    ([bucket, amount]) => ({ bucket, amount: round2(amount) }),
  );
  costsByBucketArr.sort((a, b) => a.bucket.localeCompare(b.bucket));

  return {
    totals: {
      grossRevenue: round2(grossRevenue),
      platformFees: round2(platformFees),
      netRevenue: round2(netRevenue),
      costsByBucket: costsByBucketArr,
      operatingCosts: round2(operatingCosts),
      noi: round2(noi),
      feeBase: feeConfig.feeBase,
      feePct: feeConfig.feePct,
      mgmtFee: round2(mgmtFee),
      ownerPayout: round2(ownerPayout),
      capExMemo: round2(capExMemo),
      perOwner,
    },
    feeConfigSnapshot: {
      feeConfigId: feeConfig._id,
      feePct: feeConfig.feePct,
      feeBase: feeConfig.feeBase,
      effectiveFrom: feeConfig.effectiveFrom,
    },
    sourceRefs,
  };
}

/** Set of "YYYY-MM" month keys that the period [start, end) touches. */
function monthsTouchingPeriod(
  periodStart: number,
  periodEnd: number,
): Set<string> {
  const months = new Set<string>();
  const d = new Date(periodStart);
  // Walk in UTC to match monthRange()
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  while (d.getTime() < periodEnd) {
    const y = d.getUTCFullYear();
    const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
    months.add(`${y}-${m}`);
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return months;
}
