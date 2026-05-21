# Property Owner Portal — Design Spec

**Status:** Draft for review
**Date:** 2026-05-22
**Owner:** opscentral-admin (Convex backend lives here; mobile mirror via cleaners app)
**Convex deployments:**
- **Prod (live, used by ja-bs.com):** `lovable-oriole-182` (US region) — all `npx convex deploy` calls from this repo target this.
- **Dev sandbox:** `usable-anaconda-394` (EU region, legacy) — used by `npx convex dev` for local validation. NOT live traffic.
- Both deployments are referenced in `CLAUDE.md`. The migration to `lovable-oriole-182` from the prior `whimsical-narwhal-849` happened 2026-05-02.
**Related:** YC application — owner-facing transparency wedge

---

## 1. Product positioning

We are building the owner-facing layer of a property-management platform: short-term-rental owners log in and see **radical cost transparency** on their property's P&L, the exact management-fee formula, and can act on the only two high-leverage decisions they care about — approving maintenance over a per-property threshold and blocking dates for personal use.

The wedge: Vacasa, Evolve, Awning, and every other STR mgmt company's #1 owner complaint is opaque deductions. We are the first to build the owner-facing P&L as a first-class product surface — not a quarterly PDF.

**Demo sentence:** *"Every line on the statement is a link to the source receipt — the only line you can't click through is our cut, and even that shows the formula."*

**Strategic framing:** This isn't "another vacation-rental dashboard." We took the internal property-management financial model we've been running ourselves across 8 properties and turned it into the owner-facing layer no incumbent has. The data-model upgrade IS the product upgrade: J&A goes from "we run STRs" to "we are a property management platform with radical financial transparency."

---

## 2. Locked decisions (do not re-litigate)

These came out of the brainstorming session and are user-approved:

1. **Single `owner` role.** UI adapts based on the owner's ownership records. The same role serves external landlords and silent investors; the difference is data (`role` field on `propertyOwners`), not authorization.
2. **Fee is configurable per property** — `feePct` + `feeBase`. **No system default for `feeBase`.** The onboarding wizard for any new property REQUIRES an explicit choice of `grossRevenue | netRevenue | netOperatingProfit`. There is no implicit fallback.
3. **Management fee is NOT a `propertyCostItem`.** It lives in a separate `propertyFeeConfig` table — contractual, time-versioned, snapshotted at statement issuance. A `costCategories.bucket = "managementFee"` row exists for accounting-symmetry rendering only; the source-of-truth value flows from the fee engine, not from cost items.
4. **Two surfaces.** Full portal at `opscentral-admin` web (`/owner/...`, role-gated, PWA-ready, responsive). Minimalist `(owner)` route group in `jna-cleaners-app` mobile.
5. **Two writes in v1.** Read-only everywhere except (a) approve/decline maintenance over `approvalThreshold`, (b) block dates for personal use. Everything else is read-only.
6. **NOT in v1:** in-app messaging to ops, document uploads, banking self-service, stake-weighted multi-owner voting, mobile-native date-block UI.
7. **Single source of truth:** this Convex backend. No Baserow, no spreadsheet. Migrate the existing financial model from the archive `jna-bs-admin` Convex schema.
8. **Cost data lineage:** archive uses `costCategories` + `propertyCostItems` (the structured per-property model) as source of truth — NOT `finCategories`/`finTransactions` (parallel banking-feed system, explicitly deferred).

---

## 3. Migration: archive `jna-bs-admin` → this Convex

Port these **8 tables verbatim** from `/Users/atem/sites/jnabusiness_solutions/archive/jna-bs-admin/convex/schema.ts` into this repo's `convex/schema.ts`. **Owner of the deployment is this repo** — all `npx convex deploy` calls run from `opscentral-admin/`. Do NOT run any Convex command from the sibling `jna-cleaners-app/` checkout.

### 3.1 Tables to port (verbatim shape)

| # | Table | Archive lines | Notes |
|---|---|---|---|
| 1 | `costCategories` | 698–708 | Add `bucket` field (closed enum, see §3.3). Cleanup: ensure rows exist for Insurance, Taxes, Management Fee buckets. |
| 2 | `costItems` | 710–719 | Verbatim. |
| 3 | `costTemplates` | 721–736 | Verbatim. |
| 4 | `propertyCostItems` | 738–765 | **Core.** `frequency` already supports `revenue_percentage` with `percentageRate` — used for Platform Fees (Airbnb commission). NOT used for mgmt fee. **Add `receiptStorageIds: v.optional(v.array(v.id("_storage")))`** during port (mirrors archive `capitalExpenditures`, but `v.optional` so existing prod rows don't need backfill). This is what makes "every line is a clickable receipt" work — UI treats undefined and `[]` identically. |
| 5 | `capitalExpenditures` | 595–613 | Memo line on owner statement; does NOT reduce owner payout. |
| 6 | `manualAdjustments` | 576–593 | One-off per-period corrections. |
| 7 | `monthlyCalculations` | 616–659 | Per-property monthly P&L cache. Owner statement reads/snapshots from here. |
| 8 | `propertyMonthlySettings` | 1279–1314 | Per-property per-month overrides (cleaning model, custom costs, assumptions). |

**Explicitly deferred** (do NOT port in v1): `portfolioMonthlyCalculations`, `financialSnapshots`, `capitalBalances`, `propertyReports` (superseded by new `ownerStatements`), `finCategories`/`finTransactions`/`finExclusions`/`finSyncLog`, `burnRates`, `contributors`, `contributions`, `dealVetting*`, `cmsSettings`, `appSystemSettings`, `storageSettings`, `storageSyncLog`.

### 3.2 Indexes to recreate

All ported tables keep their existing indexes:

- `costCategories`: `by_name`, `by_order`
- `costItems`: `by_category`, `by_active`
- `costTemplates`: `by_default`, `by_name`
- `propertyCostItems`: `by_property`, `by_category`
- `capitalExpenditures`: `by_property`, `by_date`
- `manualAdjustments`: `by_month`, `by_property`
- `monthlyCalculations`: `by_property`, `by_month`, `by_property_month`
- `propertyMonthlySettings`: `by_property`, `by_property_month`

### 3.3 Patches to existing tables

```ts
// users.role union (this repo, convex/schema.ts ~L18)
role: v.union(
  v.literal("cleaner"),
  v.literal("manager"),
  v.literal("property_ops"),
  v.literal("admin"),
  v.literal("owner"),   // ← NEW
),

// stays — add cancellation marker (current schema has no status field).
// Hospitable webhook handler sets cancelledAt on RESERVATION_CANCELLED events;
// the fee engine excludes any stay with cancelledAt != null from grossRevenue.
// Additive field — backward compatible.
const stays = defineTable({
  // ...existing fields...
  cancelledAt: v.optional(v.number()),       // ← NEW; unix ms when cancelled
  cancellationSource: v.optional(v.string()), // ← NEW; "hospitable" | "manual"
})

// costCategories — add `bucket` field on port
const costCategories = defineTable({
  name: v.string(),
  description: v.optional(v.string()),
  color: v.optional(v.string()),
  icon: v.optional(v.string()),
  isFixed: v.boolean(),
  sortOrder: v.number(),
  // OPTIONAL during port — existing rows have no `bucket` value yet.
  // Wave 2 backfill assigns a value to every row. A follow-up PR (post-Wave 2,
  // gated on backfill audit log) narrows this to required. Until then,
  // bucket-aware queries treat undefined as legacy → use `costCategories.name`
  // mapping table to derive the effective bucket at query time.
  bucket: v.optional(v.union(                 // ← NEW (open enum, transitional)
    v.literal("lease"),
    v.literal("cleaning"),
    v.literal("supplies"),
    v.literal("utilities"),
    v.literal("maintenance"),
    v.literal("lawnPoolOutdoor"),
    v.literal("platformFees"),                // backfill target for legacy "payouts"
    v.literal("subscriptions"),
    v.literal("labor"),
    v.literal("insurance"),                   // ← currently missing in prod
    v.literal("taxes"),                       // ← currently missing in prod
    v.literal("managementFee"),               // ← accounting-symmetry only
    v.literal("other"),
  )),
  createdAt: v.number(),
}).index("by_name", ["name"]).index("by_order", ["sortOrder"]).index("by_bucket", ["bucket"]);
```

### 3.4 Data backfill required

From the production probe (verified findings):

- **Existing buckets in prod (from category names):** `cleaning`, `lease`, `utilities`, `payouts`, `other`, `subscriptions`
- **Missing categories to seed:** Insurance, Taxes, Management Fee (the latter for accounting-symmetry rendering only — actual fee flows through `propertyFeeConfig`)
- **Re-bucketing of ~15 misfiled prod line items** (one-time, idempotent backfill script):
  - Amazon refills currently under Utilities → move to `supplies`
  - Lawn / Propane currently under Cleaning → move to `lawnPoolOutdoor`
  - VA-Haseeb currently under Fixed Costs → move to `labor`
  - Airbnb commission rows → confirm `bucket = "platformFees"` (legacy `payouts`)
- **Recommended for v1.** If we ship the first statement without this cleanup, the first owner sees mis-categorized lines on day one — which directly contradicts the radical-transparency wedge.

The backfill must be a single Convex internal mutation, idempotent (skip rows already correctly bucketed), with a dry-run flag and an audit-log output.

---

## 4. New tables (6) — added to this repo's `convex/schema.ts`

### 4.1 `propertyOwners`

```ts
const propertyOwners = defineTable({
  propertyId: v.id("properties"),
  userId: v.id("users"),                      // the owner's user account (role: "owner")
  stakePct: v.number(),                       // 0..1; sum across active owners for a property should equal 1
  role: v.union(
    v.literal("landlord"),                    // external owner
    v.literal("investor"),                    // silent capital partner
  ),
  isPrimaryApprover: v.boolean(),             // exactly one true per property among active rows
  effectiveFrom: v.number(),
  effectiveTo: v.optional(v.number()),        // open-ended ≡ currently active
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
})
  .index("by_property", ["propertyId"])
  .index("by_user", ["userId"])
  .index("by_property_and_effective", ["propertyId", "effectiveFrom"])
  .index("by_user_and_active", ["userId", "effectiveTo"]);
```

**Invariants** (enforced by the mutation that writes this table, not by Convex schema):
- At any wall-clock time, the active rows for one `propertyId` must sum `stakePct` to 1.0 (±0.0001 for float tolerance).
- Exactly one active row per property has `isPrimaryApprover: true`.
- `effectiveTo` is exclusive (`[from, to)`).

### 4.2 `propertyFeeConfig`

```ts
const propertyFeeConfig = defineTable({
  propertyId: v.id("properties"),
  feePct: v.number(),                          // 0..1; typically 0.20
  feeBase: v.union(
    v.literal("grossRevenue"),
    v.literal("netRevenue"),                   // grossRevenue − platformFees
    v.literal("netOperatingProfit"),           // netRevenue − operatingCosts
  ),
  approvalThreshold: v.number(),               // USD; maintenance ≥ this requires owner approval
  autoApproveAfterDays: v.optional(v.number()), // OFF by default; set to N for auto-approve after N days no response
  effectiveFrom: v.number(),
  effectiveTo: v.optional(v.number()),         // open-ended ≡ currently active
  createdBy: v.id("users"),
  createdAt: v.number(),
})
  .index("by_property", ["propertyId"])
  .index("by_property_and_effective", ["propertyId", "effectiveFrom"]);
```

**Immutability:** never UPDATE an existing row. Always close the current row by setting `effectiveTo`, then INSERT a new row. This guarantees we can always answer "what fee formula was in force on date X for property Y."

### 4.3 `ownerStatements`

```ts
const ownerStatements = defineTable({
  propertyId: v.id("properties"),
  periodStart: v.number(),                    // unix ms; inclusive
  periodEnd: v.number(),                      // unix ms; exclusive
  status: v.union(v.literal("draft"), v.literal("issued")),
  snapshotTotals: v.object({
    grossRevenue: v.number(),
    platformFees: v.number(),
    netRevenue: v.number(),                   // gross − platformFees
    // Array form (NOT v.record) — v.record may not be available in the installed
    // Convex validator version, and the rest of this codebase consistently uses
    // arrays of {key, value} or v.any() for dynamic-key maps. Verify validator
    // version during Wave 1; if v.record IS available, swap is mechanical.
    costsByBucket: v.array(v.object({
      bucket: v.string(),
      amount: v.number(),
    })),
    operatingCosts: v.number(),               // sum of costsByBucket excluding capExMemo
    noi: v.number(),                          // netRevenue − operatingCosts
    feeBase: v.union(
      v.literal("grossRevenue"),
      v.literal("netRevenue"),
      v.literal("netOperatingProfit"),
    ),
    feePct: v.number(),
    mgmtFee: v.number(),                      // baseValue × feePct
    ownerPayout: v.number(),                  // noi − mgmtFee
    capExMemo: v.number(),                    // sum of capitalExpenditures in period; memo only
    perOwner: v.array(v.object({
      ownerId: v.id("propertyOwners"),
      userId: v.id("users"),
      stakePct: v.number(),
      payout: v.number(),                     // ownerPayout × stakePct
    })),
  }),
  feeConfigSnapshot: v.object({
    feeConfigId: v.id("propertyFeeConfig"),
    feePct: v.number(),
    feeBase: v.string(),
    effectiveFrom: v.number(),
  }),
  // Discriminated union per source table — keeps Convex Id types intact so
  // the renderer can `ctx.db.get(ref.rowId)` without runtime guards.
  sourceRefs: v.array(v.union(
    v.object({
      table: v.literal("propertyCostItems"),
      rowId: v.id("propertyCostItems"),
      amount: v.number(),
      bucket: v.string(),
    }),
    v.object({
      table: v.literal("manualAdjustments"),
      rowId: v.id("manualAdjustments"),
      amount: v.number(),
      bucket: v.optional(v.string()),
    }),
    v.object({
      table: v.literal("stays"),
      rowId: v.id("stays"),
      amount: v.number(),                    // revenue contribution
    }),
    v.object({
      table: v.literal("capitalExpenditures"),
      rowId: v.id("capitalExpenditures"),
      amount: v.number(),                    // memo
    }),
  )),
  // Note: renderer MUST still defensively handle null from ctx.db.get because
  // sourced rows can theoretically be deleted (we discourage it but cannot
  // enforce at the DB layer). Missing source = render as "(source removed)"
  // line, NEVER recompute or fail-closed.
  issuedAt: v.optional(v.number()),
  issuedBy: v.optional(v.id("users")),
  // Server-rendered PDF artifact. Populated by `renderOwnerStatementPdf`
  // action scheduled by the issuance mutation. undefined ≡ still generating.
  pdfStorageId: v.optional(v.id("_storage")),
  pdfTemplateVersion: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
})
  .index("by_property", ["propertyId"])
  .index("by_property_and_period", ["propertyId", "periodStart"])
  .index("by_status", ["status"]);
```

**Trust contract:** once `status = "issued"`, the row is frozen. Any subsequent edit to a sourced `propertyCostItem` / `manualAdjustment` / `stay` does NOT change this statement's `snapshotTotals` or `sourceRefs`. Corrections flow forward as new `manualAdjustments` against the next open period.

### 4.4 `maintenanceApprovalRequests`

```ts
const maintenanceApprovalRequests = defineTable({
  propertyId: v.id("properties"),
  ownerId: v.id("propertyOwners"),            // primary approver SNAPSHOTTED at request time;
                                              // retains authority even if the property's
                                              // primary approver changes before decision.
                                              // Pattern matches "issued statement immutability."
  proposedCost: v.number(),
  description: v.string(),
  photoIds: v.array(v.id("photos")),
  requestedBy: v.id("users"),                 // ops user who originated the request
  status: v.union(
    v.literal("pending"),
    v.literal("approved"),
    v.literal("declined"),
    v.literal("auto_approved"),               // only if propertyFeeConfig.autoApproveAfterDays is set
  ),
  decidedAt: v.optional(v.number()),
  decidedBy: v.optional(v.id("users")),       // the owner user
  decidedNote: v.optional(v.string()),
  // When approved, the resulting cost row is booked through propertyCostItems.
  resultingCostItemId: v.optional(v.id("propertyCostItems")),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
})
  .index("by_property", ["propertyId"])
  .index("by_owner", ["ownerId"])
  .index("by_status", ["status"])
  .index("by_property_and_status", ["propertyId", "status"]);
```

### 4.5 `ownerDateBlocks`

```ts
const ownerDateBlocks = defineTable({
  propertyId: v.id("properties"),
  ownerId: v.id("propertyOwners"),
  startDate: v.number(),                      // unix ms; inclusive
  endDate: v.number(),                        // unix ms; exclusive
  note: v.optional(v.string()),
  // Channel-sync state. If hospitableConfig outbound sync is wired, set syncedToChannelsAt.
  syncedToChannelsAt: v.optional(v.number()),
  createdAt: v.number(),
})
  .index("by_property", ["propertyId"])
  .index("by_owner", ["ownerId"])
  .index("by_property_and_start", ["propertyId", "startDate"]);
```

**Strict reject** on overlap with existing `stays` rows for the same property.

### 4.6 `ownerNotificationPrefs`

```ts
const ownerNotificationPrefs = defineTable({
  userId: v.id("users"),
  channel: v.union(v.literal("email"), v.literal("sms"), v.literal("push")),
  statementIssued: v.boolean(),
  approvalRequest: v.boolean(),
  incidentReport: v.boolean(),
  updatedAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_user_and_channel", ["userId", "channel"]);
```

One row per (userId, channel). Owner picks which events fire on which channel.

---

## 5. Fee engine — the heart of the product

For a given `(propertyId, periodStart, periodEnd)`:

```
1. grossRevenue   = Σ stays.totalAmount where checkInAt ∈ [periodStart, periodEnd)
                    AND stay.propertyId = propertyId
                    AND stay.cancelledAt IS NULL
                    + Σ manualAdjustments WHERE type = "revenue" AND month ∈ period
                      AND propertyId = this property
                      (revenue corrections — e.g. late-landing payout — add to
                       gross. They flow through netRevenue → feeBase, so they
                       DO affect the mgmt fee. This is intentional: a revenue
                       correction is owed-revenue-as-if-it-came-on-time.)
2. platformFees   = Σ propertyCostItems where bucket = "platformFees"
                    resolved for period (see §5.1 frequency resolution)
3. netRevenue     = grossRevenue − platformFees
4. operatingCosts = Σ all other propertyCostItems (every bucket except platformFees,
                    managementFee, and capitalExpenditures)
                    + Σ manualAdjustments WHERE type = "expense" AND month ∈ period
                      AND propertyId = this property
                    + portfolio-level manualAdjustments (propertyId = null) are
                      EXCLUDED from per-property statements — they only show up
                      in the deferred portfolio roll-up
5. NOI            = netRevenue − operatingCosts
6. feeConfig      = the propertyFeeConfig row active at periodStart.
                    Policy: the rate in force on the FIRST DAY of the period
                    governs the entire period. Mid-period changes (effectiveFrom
                    inside the period) apply to the NEXT period. This matches the
                    "owner sees the rate at the start of the month they're billed
                    for" contract and is what gets snapshotted in feeConfigSnapshot.
7. baseValue      = switch (feeConfig.feeBase) {
                      "grossRevenue":       grossRevenue;
                      "netRevenue":         netRevenue;
                      "netOperatingProfit": NOI;
                    }
8. mgmtFee        = max(0, baseValue) × feeConfig.feePct
                    // baseValue clamped at 0: never charge fee on a negative base
9. ownerPayout    = max(0, NOI − mgmtFee)
                    // floor at 0: owner is never billed for a loss period in v1.
                    // The deficit (NOI − mgmtFee, if negative) is recorded as a
                    // manualAdjustment(type="expense", category="prior_period_deficit")
                    // on the next open period, surfaced explicitly on the next
                    // statement as a "Carried from [prior period]" line.
10. capExMemo     = Σ capitalExpenditures.amount where purchaseDate ∈ period
                    // MEMO ONLY — does NOT reduce ownerPayout
11. owners        = propertyOwners rows active at periodStart.
                    Same policy as feeConfig: ownership snapshot is taken at the
                    start of the period. Mid-period ownership changes apply to
                    the next period. This freezes payout splits at issuance time
                    and avoids contested mid-period transitions.
12. perOwner[i]   = round(ownerPayout × owners[i].stakePct, 2 dp)
                    Σ stakePct must equal 1.0 (±0.0001) at periodStart.
                    Rounding residual (ownerPayout − Σ perOwner[i].payout) is
                    assigned to the owner with the LARGEST stakePct (ties broken
                    by lowest ownerId). Guarantees Σ perOwner[i].payout
                    == ownerPayout exactly.
```

### 5.1 Frequency resolution

`propertyCostItems.frequency` defines how the row's `amount` resolves into a period total:

Let `I = intersection of period [start, end) with the row's active window [startDate ?? -∞, endDate ?? +∞)`. Let `D_I` = duration of `I` in days.

| frequency | resolution |
|---|---|
| `one_time` | include `amount` iff `startDate ∈ [start, end)` |
| `monthly` | `amount × (D_I / 30.44)`  — a full calendar month of activity yields ≈ amount × 1. A row active for the entire period contributes `amount × (period_days / 30.44)`. |
| `quarterly` | `amount × (D_I / 91.25)` |
| `annual` / `yearly` | `amount × (D_I / 365.25)` |
| `per_booking` | `amount × (count of non-cancelled stays whose checkInAt ∈ I)` |
| `revenue_percentage` | `grossRevenue × percentageRate` (the row's `amount` is ignored; `I` is implicit via grossRevenue's period filter) |

**`manualAdjustments.month` resolution:** the archive stores `month` as a `"YYYY-MM"` string. The engine treats the row as falling in `[firstOfMonth, firstOfNextMonth)` (in the property's timezone) and intersects with the requested period. A row whose month does not fully fall inside `[periodStart, periodEnd)` is included pro-rata by day-count — this matters only when periods are non-month-aligned (rare in v1; default period is a calendar month).

A row is "active" iff `isActive = true` AND `now ∈ [startDate ?? -∞, endDate ?? +∞)`.

`propertyMonthlySettings` overrides apply for the matching month (`YYYY-MM`). Semantics are **replace, not add**:

- `cleaningModel = "percent"` → cleaning bucket for that month is REPLACED with `grossRevenue × cleaningPercent`. Every `bucket: "cleaning"` cost item is excluded from operatingCosts for that month.
- `cleaningModel = "flat_cap"` → cleaning bucket total is `min(sum_of_cleaning_items, cleaningFlatCap)`.
- `utilitiesOverride` → REPLACES the period's utilities-bucket total. All `bucket: "utilities"` items are excluded for the month.
- `customCosts[]` → ADDITIONAL ad-hoc line items for that month, booked into `bucket: "other"`.

### 5.2 Three non-negotiable trust rules

1. **Issued statements are immutable.** Editing a `propertyCostItem` after a period's statement is issued does NOT change that statement. Corrections land as a `manualAdjustment` on the next open period. The UI surfaces the correction on the next statement with an explicit "Correction from [prior period]" line.

   **Enforcement** (Convex has no DB-level write-protection — discipline lives in code):
   - All writes to `ownerStatements` go through `convex/owner/statements.ts` mutations. NEVER call `ctx.db.patch(statementId, ...)` from anywhere else.
   - Every mutation in that module starts with `await assertStatementMutable(ctx, statementId)` which throws if `status === "issued"`. The only mutation that bypasses this guard is `reIssueStatementForCatastrophicCorrection`, which is admin-only and writes an audit log entry — explicitly out of scope for v1 but reserved.
   - Lint rule (ESLint custom or grep-based CI check): fail the build if any file outside `convex/owner/statements.ts` imports `ownerStatements` and calls `.patch` or `.replace`.

2. **Fee config is time-versioned.** `propertyFeeConfig` rows are append-only with `effectiveFrom/effectiveTo`. Same enforcement pattern: a single `upsertPropertyFeeConfig` mutation closes the prior row (sets `effectiveTo`) and inserts a new one in one transaction. The statement snapshots which `feeConfigId` was in force at `periodStart` (see §5 step 6).

3. **Drafts recompute live.** Before `status = "issued"`, the statement displays a live-computed projection that updates as costs land. After issuance, `snapshotTotals` is the only truth for that period.

**Invariant: `propertyOwners` rows are never deleted.** They are only closed by setting `effectiveTo`. This ensures historical snapshots in `ownerStatements.snapshotTotals.perOwner[].ownerId` always resolve.

### 5.3 Statement issuance flow

1. Ops user opens the property's "Statements" tab → "Draft for [Month]".
2. The draft pane computes everything live via a query. Owner-side draft view is read-only and shows a "Pending finalization by ops" banner.
3. Ops user clicks "Issue statement." Confirmation modal shows totals snapshot.
4. `issueOwnerStatement` mutation: re-runs the engine inside the mutation (so the snapshot reflects the current state at the moment of the click — no TOCTOU), writes `ownerStatements` row with `status = "issued"`, `snapshotTotals`, `feeConfigSnapshot`, `sourceRefs`, `issuedAt`, `issuedBy`. Emits `statementIssued` event.
5. Notification fanout to all `propertyOwners` of the property, respecting `ownerNotificationPrefs`.
6. Owner sees the statement in their portal. Every line item on the statement is a link to its source — either the receipt photo (via `propertyCostItems.metadata.receiptPhotoId` if present), the stay detail, or the adjustment record. The mgmt-fee line is the only one without a backing receipt; it shows the formula instead.

---

## 6. Information architecture

### 6.1 Web (this app, `opscentral-admin`)

All routes gated by `users.role = "owner"` (or admin/property_ops viewing-as-owner via a future impersonation flow — explicitly v2). Owner cannot access non-`/owner/*` routes.

```
/owner                        Dashboard — adapts: single-property OR portfolio roll-up
                                • Single property: KPI cards (this-month payout, occupancy,
                                  pending approvals badge) + recent activity feed
                                • Multi-property: portfolio table + KPI roll-up
/owner/properties             List view (only rendered if owner.activeProperties > 1)
/owner/properties/[id]        Per-property hub with tabs:
  ├─ Overview                 Snapshot + current month draft preview + next-stay teaser
  ├─ Statements               List of issued statements + draft for current period
  │  └─ [statementId]         Drill-down: clickable line items, PDF download
  ├─ Costs                    Live cost ledger; filter by bucket, search, export CSV
  ├─ Bookings                 Stay-by-stay revenue feed (read-only calendar + list)
  ├─ Approvals                Maintenance approval requests (history + pending)
  │  └─ [requestId]           Approve / decline view with photos
  └─ Documents                Static doc archive (lease, mgmt agreement) — read-only in v1
/owner/blocks                 Date-block calendar (cross-property) — owner write action #2
  └─ new                      Form to add a block; strict-reject on stay overlap
/owner/settings               Profile + notification prefs (matrix: channels × event types)
/owner/help                   Static FAQ + mailto:ops
```

### 6.2 Mobile (`jna-cleaners-app`, `(owner)` route group)

Glanceable. Decision-focused. Not a portal — a remote control.

```
app/(owner)/
├── _layout.tsx               Tabs: Home · Approvals · Notifications · Settings
├── index.tsx                 Glanceable home:
│                              • Payout-to-date (this month)
│                              • Occupancy %
│                              • Next payout ETA
│                              • Approval badge (pending count)
│                              • Recent activity (last 5 events)
├── property/[id].tsx         (Rendered only if multi-property; opens drill-down)
├── statement/[id].tsx        View one statement; PDF download → native viewer
├── approval/[id].tsx         The one write surface: Approve / Decline + note
├── notifications.tsx         Recent notification list
└── settings.tsx              Notification channel toggles only
```

**Mobile NOT in v1:** cost log, bookings calendar, multi-month charts, document archive, date-block UI (owners on mobile fill a "request block" form ops processes).

### 6.3 Web PWA

The web portal IS the PWA. Responsive Tailwind layout collapses to single-column on phone widths. "Add to Home Screen" prompt on first visit (mobile Safari/Chrome). Service worker caches the last 3 issued statements for offline reading. Web Push for owners who opt in; falls back to email/SMS via existing `ownerNotificationPrefs`.

If the native `(owner)` route group slips, the PWA covers "on the go" without dropping the owner-on-mobile use case.

---

## 7. Approval workflows

### 7.1 Maintenance approval

```
ops creates maintenance work order
  │
  ├─ proposedCost < propertyFeeConfig.approvalThreshold
  │     → cost books immediately as propertyCostItem
  │     → no notification to owner (it'll show on the next statement)
  │
  └─ proposedCost ≥ propertyFeeConfig.approvalThreshold
        → no cost booked yet
        → INSERT maintenanceApprovalRequest (status = pending)
        → notification fanout to primary-approver owner via every channel they enabled
        → owner reviews in /owner/properties/[id]/approvals or mobile approval/[id]
        │
        ├─ owner approves
        │     → INSERT propertyCostItem (one_time, bucket = "maintenance")
        │     → resultingCostItemId set on the request
        │     → status = approved
        │     → ops notified of approval
        │
        ├─ owner declines
        │     → no propertyCostItem written
        │     → status = declined
        │     → ops notified with decidedNote
        │
        └─ no response in autoApproveAfterDays days (only if configured)
              → status = auto_approved
              → propertyCostItem booked as if approved
              → both ops and owner notified
```

**Auto-approval scheduling:** a `convex/crons.ts` entry runs hourly, scanning `maintenanceApprovalRequests` with `status = "pending"` whose `createdAt + (autoApproveAfterDays × 24h) ≤ now` (joining `propertyFeeConfig` for the threshold). For each, runs `decideMaintenanceApprovalRequest` with `auto: true`. **Decision authority is captured at request creation time** (the `ownerId` snapshot), so the cron does not need to re-resolve the primary approver.

**Multi-owner:** only the row with `isPrimaryApprover = true` decides. Co-owners see the request in their feed as read-only with "pending [Owner Name]'s decision."

**Auto-approval default:** `autoApproveAfterDays` is unset. Explicit per-property config required to enable.

### 7.2 Date blocks

```
owner submits start/end dates via web (or mobile request-form forwarded to ops)
  │
  ├─ overlap with existing stays for propertyId?
  │     → STRICT REJECT with "These dates are booked: [stay summary]"
  │
  └─ no overlap
        → INSIDE the mutation: re-query stays by (propertyId, checkInAt range)
          and re-check overlap atomically (TOCTOU guard against a stay landing
          between the form-validation query and the insert).
        → INSERT ownerDateBlock
        ├─ if hospitableConfig has outbound channel sync support
        │     → enqueue push to Airbnb/VRBO; set syncedToChannelsAt on success
        └─ else
              → display "Ops will handle channel blocking" + notify ops
```

---

## 8. Build sequencing (v1)

Five-wave build. Earlier waves unblock later ones.

| Wave | Scope | Deliverable | Slip-able? |
|---|---|---|---|
| **1. Schema migration** | Port 8 archive tables + 6 new owner tables + `users.role` patch + `costCategories.bucket` patch | `convex/schema.ts` updated; `npx convex deploy` succeeds from this repo | No — blocks everything |
| **2. Cost-data cleanup** | Idempotent backfill: seed missing categories (Insurance/Taxes/MgmtFee bucket rows); re-bucket ~15 misfiled prod line items | Internal mutation `internal.ownerPortal.backfill.migrateCostBuckets` with dry-run + audit log; ops runs it once | Recommended for v1; if slipped, first statement shows mis-categorized rows |
| **3. Fee/cost engine** | Convex queries: `getOwnerStatementDraft`, `getOwnerStatement`, `listOwnerStatements`, `getOwnerCostLedger`, `getOwnerDashboard`. Mutations: `issueOwnerStatement`, `createMaintenanceApprovalRequest`, `decideMaintenanceApprovalRequest`, `createOwnerDateBlock`, `upsertPropertyFeeConfig`, `upsertPropertyOwner` | Unit-tested fee engine; engine is pure given (propertyId, period, snapshotOfTables) | No |
| **4. Web portal** | `/owner/*` route group, all surfaces in §6.1, responsive Tailwind, PWA manifest + service worker | The YC demo surface. Owner can log in, see live P&L, approve maintenance, block dates | No — this is the wedge |
| **5. Mobile (owner) route group** | `(owner)/*` routes in sibling `jna-cleaners-app` repo, same Convex backend | Native glanceable + approval flow | **Yes** — PWA covers the mobile use case if v1 deadline crunches |

---

## 9. Cost-bucket display mapping

Owner statement presentation buckets (rendered in code, e.g. `convex/owner/statementBuckets.ts`). NOT a database table — pure mapping layer between `costCategories.bucket` and the section headers an owner sees:

```
Lease / Rent              ← bucket: "lease"
Cleaning                  ← bucket: "cleaning"
Supplies & Restocks       ← bucket: "supplies"
Utilities                 ← bucket: "utilities"
Maintenance & Repairs     ← bucket: "maintenance"
Lawn / Pool / Outdoor     ← bucket: "lawnPoolOutdoor"
Platform Fees             ← bucket: "platformFees"  (separates above-the-line from operating)
Software & Subscriptions  ← bucket: "subscriptions"
Labor & Contractors       ← bucket: "labor"
Insurance                 ← bucket: "insurance"
Taxes                     ← bucket: "taxes"
─────────────────────────────────────────────
Capital Expenditures (memo) ← MEMO LINE, not subtracted
Other / Adjustments       ← bucket: "other" + manualAdjustments
─────────────────────────────────────────────
Management Fee            ← FROM FEE ENGINE, not from cost items
Owner Payout              ← computed
```

---

## 10. Auth & permissions

- `users.role = "owner"` is required for `/owner/*` web routes and `(owner)/*` mobile routes.
- **Next.js route guard (defense-in-depth, not the only check):** the `/owner` route group's `layout.tsx` reads the Clerk session, fetches the user's Convex role, and redirects non-owners to `/`. Owner can't even render the page. Mirrored in mobile `(owner)/_layout.tsx`.
- **Convex query/mutation authorization is the actual security boundary** (route guards are bypassable). Every owner-facing query and mutation MUST call `assertOwnerOfProperty(ctx, propertyId)` from `convex/owner/auth.ts`. Pattern: wrap every owner-facing function in a `withOwnerAuth(propertyId, handler)` higher-order helper — convention drifts, wrappers don't. Lint check: any file under `convex/owner/` that defines `query`/`mutation` without invoking the wrapper fails CI.
- Maintenance approval mutations additionally verify the caller's userId matches `propertyOwners.userId` for the snapshotted `ownerId` on the request, AND that `propertyOwners.isPrimaryApprover === true` on the snapshotted row.
- Date-block mutations require any active ownership for the property.
- Admin and property_ops roles can view-as-owner via an explicit impersonation flow — **deferred to v2.**

---

## 11. Notification fanout

When a fanout event fires (statement issued, approval request created, incident reported on owned property):

```
for each propertyOwners row active on the property at event time:
  for each ownerNotificationPrefs row for that userId:
    if prefs.<eventField> is true:
      enqueue notification on prefs.channel
```

Channels:
- `email` → existing transactional email infra (Resend; reuse `serviceUsageEvents.serviceKey = "resend"`)
- `sms` → not implemented in v1 backend; spec the prefs row anyway so the toggle is grayed-out instead of absent. Phase-2 wire-up.
- `push` → existing push infra via `users.pushToken` (mobile) + Web Push (PWA, opt-in only)

Always insert a corresponding `notifications` row (existing table at schema.ts:1116–1160; extend the `type` union with `"owner_statement_issued"`, `"owner_approval_request"`, `"owner_incident_reported"`). **Co-owners are notified** when the primary approver decides — `notifications` row only, no push — so they have an audit trail.

**Schema-change note:** extending `notifications.type` is a closed-union widening that affects the cleaners app at typecheck time. See §12 runbook step 3 for the lockstep procedure.

---

## 12. Migration runbook

Order of operations to land Wave 1 + Wave 2 safely on `lovable-oriole-182`:

1. Land schema PR (Wave 1) on a feature branch in `opscentral-admin`. CI verifies typecheck.
2. From this repo: `npx convex dev` against the sandbox deployment (NOT `lovable-oriole-182`) and verify schema accepts. (Note: `usable-anaconda-394` is the existing dev sandbox per `CLAUDE.md`.)
3. **Open the cleaners-app mirror PR in lockstep.** `cd ../../jna-cleaners-app && npm run sync:convex-backend` regenerates the typed client. The mobile build will see the widened `users.role` union (`"owner"` added) AND the widened `notifications.type` union — both are additive but typecheck-affecting. The cleaners PR cannot merge before opscentral's, and opscentral cannot deploy until cleaners has the new generated types in main, or the next mobile build breaks. Sequence: open both PRs → merge opscentral → run cleaners sync → merge cleaners → THEN deploy opscentral to prod.
4. Both PRs reviewer-approved. Verify schema diff is additive only (no removed fields, no narrowed unions).
5. Merge opscentral. Merge cleaners after sync. From opscentral main: `CONVEX_DEPLOY_KEY=$PROD_CONVEX_DEPLOY_KEY npx convex deploy`. Confirm Convex dashboard shows new tables + indexes.
6. Ship the cleaners build (no behavior change yet — just schema awareness).
7. Wave 2 cleanup mutation deployed in a follow-up PR. Run with `dryRun: true` first; ops reviews the audit log; then run for real.

**Rollback:** schema changes are additive. If we need to abort, the only follow-up is removing the new tables (data loss only on the new tables). The role widening is forward-compatible with existing rows.

---

## 13. Resolved during review

Items previously flagged as open, resolved in this revision:

1. ✅ **Receipt linkage** → `propertyCostItems.receiptStorageIds: v.array(v.id("_storage"))` added during port (§3.1 row 4). Mirrors archive `capitalExpenditures` pattern.
2. ✅ **Stake validation** → enforced inside `upsertPropertyOwner` mutation atomically (§4.1 invariants).
3. ✅ **`monthlyCalculations` strategy** → option (b): compute on-the-fly from `propertyCostItems` + `stays` for drafts; `ownerStatements.snapshotTotals` IS the cache at issuance.
4. ✅ **Co-owner notification on decisions** → yes, `notifications` row only, no push (§11).
5. ✅ **Mid-period fee-config change** → row active at `periodStart` governs the period; mid-period changes apply to next period (§5 step 6).
6. ✅ **Mid-period ownership change** → same policy as fee config (§5 step 11).
7. ✅ **Negative NOI** → `ownerPayout` floored at 0; deficit carried forward as `manualAdjustment(type="expense", category="prior_period_deficit")` (§5 step 9).
8. ✅ **Stake rounding residual** → assigned to largest stakeholder (ties: lowest ownerId). Σ perOwner.payout == ownerPayout exactly (§5 step 12).
9. ✅ **Stay cancellation signal** → add `cancelledAt: v.optional(v.number())` to `stays` during migration (§3.3).
10. ✅ **`v.record` availability** → spec uses `v.array(v.object({...}))` form to sidestep version uncertainty (§4.3).
11. ✅ **`sourceRefs` type safety** → discriminated union per table, real `v.id(...)` types (§4.3).
12. ✅ **Immutability enforcement** → centralized in `convex/owner/statements.ts` with `assertStatementMutable` + CI lint (§5.2).

## 13a. Confirmed by user 2026-05-22

1. ✅ **Currency.** Single currency per property (read from `properties.currency`). Multi-currency owner support deferred to v2.
2. ✅ **Auto-approval default off.** `autoApproveAfterDays` is unset by default. Per-property opt-in only.
3. ✅ **Period = calendar month, property TZ.** All v1 statements are monthly periods aligned to the property's timezone. No weekly or custom-period billing in v1.

## 13b. Confirmed by user 2026-05-22

1. ✅ **PDF = server-rendered, part of the immutable snapshot.** Required by the §14 byte-identical acceptance criterion, the trust posture of `snapshotTotals`/`feeConfigSnapshot`, and the email-attachment use case. Two schema additions to `ownerStatements`:
   - `pdfStorageId: v.optional(v.id("_storage"))` — populated by an action after issuance; `undefined` while PDF is generating.
   - `pdfTemplateVersion: v.optional(v.number())` — which template version generated these bytes. Enables re-rendering on a template bug-fix without losing audit trail.

---

## 14. Acceptance criteria (for plan phase)

- An owner with one property logs in, sees the dashboard, opens the current month's draft, and every cost line resolves to a clickable source. **Live before mgmt fee:** the formula is visible above the fee line.
- An owner with two properties sees a portfolio roll-up and can drill into either.
- An ops user issues a statement. The owner is notified per their prefs. The statement is byte-identical to what was previewed at issue time, even if a cost row is edited 5 minutes later.
- A maintenance request over threshold pings the primary approver. Approve → cost books and the request shows `resultingCostItemId`. Decline → no cost booked. Owner sees the request close in real time.
- An owner submits a date block. Overlap with a stay → rejected with stay summary. No overlap → block created, ops notified (or channels synced if hospitable supports it).
- Mobile app shows the glanceable home and lets the primary approver decide a maintenance request from their phone in three taps.

---

## 15. Non-goals (v1)

- In-app messaging between owners and ops (use email / phone)
- Owner-side document upload
- Banking self-service (changing payout account, viewing transfer status)
- Stake-weighted multi-owner voting on approvals
- Mobile-native date-block calendar UI
- View-as-owner for admins/ops
- Multi-currency owner support
- Owner-initiated cost dispute workflow (handled out-of-band via email in v1)
- **Multi-role launch picker.** `users.role` remains a single value; a partner who is both a manager AND an owner needs two separate accounts in v1 (one with `role: "manager"`, one with `role: "owner"`). The cleaners-app's existing `useRoleGuard` + `roleRouteMap` continues to assume one role per user — Wave 5 does NOT extend it. A future role-picker is in-scope for v2 once we have the first partner-who-also-owns case. Mitigation for v1: J&A partners who own properties can be onboarded with a separate `+owner` email alias.

---

*End of design spec. Awaiting reviewer pass before handoff to `writing-plans`.*
