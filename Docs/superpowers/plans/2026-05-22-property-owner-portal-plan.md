# Property Owner Portal — Wave 1 Implementation Plan (Schema Migration)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the schema foundation for the Property Owner Portal — port 8 financial tables from the archive `jna-bs-admin` Convex schema, add 6 net-new owner-portal tables, and patch 3 existing tables — all additive, all backward-compatible, all deployed lockstep with the cleaners-app mirror.

**Architecture:** Single Convex backend (`lovable-oriole-182`, US prod) owned by `opscentral-admin`. Schema is the only thing this wave delivers — no queries, no mutations, no UI. Lockstep coordination with sibling `jna-cleaners-app` via `npm run sync:convex-backend` so the cleaners build doesn't break on `users.role` and `notifications.type` union widening.

**Tech Stack:** Convex (schema + validators via `convex/values`), TypeScript strict, Node `node --test` runner (project's existing `npm test`), git worktree workflow per project `CLAUDE.md`.

**Scope NOT in this plan:** Wave 2 (cost-data backfill), Wave 3 (fee engine + queries/mutations), Wave 4 (web portal UI), Wave 5 (mobile `(owner)` route group), PDF rendering action. Each gets its own plan once Wave 1 is in prod.

**Source spec:** [docs/superpowers/specs/2026-05-22-property-owner-portal-design.md](../specs/2026-05-22-property-owner-portal-design.md) — §3 (migration), §4 (new tables), §12 (runbook).

---

## File Structure

This wave touches exactly these files in this repo:

| File | Action | Purpose |
|---|---|---|
| `convex/schema.ts` | Modify | Add 8 ported tables, 6 new tables, patch `users.role`, `notifications.type`, add `stays.cancelledAt`+`cancellationSource`. Register all new tables in the `defineSchema` export. |
| `convex/owner/README.md` | Create | One-page explainer of the owner-portal subsystem. Points future readers at the spec and lists the new tables. No code. |
| `convex/owner/constants.ts` | Create | Canonical `BUCKETS` const array + derived `Bucket` TS type. Source of truth for cost-bucket values during the interim period when `costCategories.bucket` is `v.optional(v.union(...))` — every future writer (Wave 2 backfill, future bucket-mutating code) validates against `BUCKETS.includes(value)` at the mutation boundary so the eventual narrowing PR is purely mechanical. |
| `convex/_generated/*` | Auto-regen | `npx convex codegen` (or `npx convex dev` momentarily) regenerates these. NEVER edit by hand. |
| `convex/lib/schemaShape.test.ts` | Create | Node-test that imports the schema and asserts the new tables/fields exist with the expected shapes. Cheap insurance against accidental deletion. Lives next to source per repo convention (see `convex/lib/companyScope.test.ts`). |

And in sibling repo `jna-cleaners-app/`:

| File | Action | Purpose |
|---|---|---|
| `convex/schema.ts` | Auto-replace | Replaced by `npm run sync:convex-backend` script. |
| `convex/_generated/*` | Auto-regen | Same as above. |

**No queries, no mutations, no UI components in this wave.**

---

## Pre-flight (do once, before Task 1)

- [ ] **Pre-flight 1: Confirm worktree state**

  Run from this checkout:

  ```bash
  git rev-parse --abbrev-ref HEAD
  git status --short
  ```

  Expected: branch is **not** `main`, working tree clean. If on `main`, abort — per project `CLAUDE.md`, feature work happens in worktrees, never on `main`.

- [ ] **Pre-flight 2: Confirm Node 20+ and Convex CLI available**

  ```bash
  node --version          # expect v20.x or v22.x
  npx convex --version    # expect a version string, no install prompt
  ```

  If Node is older, run `nvm use lts/jod` (Node 22) before any Convex commands.

- [ ] **Pre-flight 3: Confirm sibling cleaners-app is accessible**

  ```bash
  ls /Users/atem/sites/jnabusiness_solutions/apps-ja/jna-cleaners-app/scripts/sync-convex-backend-from-admin.sh
  ```

  Expected: file exists. If not, the lockstep migration runbook (§12) cannot run — escalate.

- [ ] **Pre-flight 4: Confirm baseline `npm test` state (it is currently failing on main)**

  ```bash
  npm test 2>&1 | tail -5
  ```

  Expected: as of 2026-05-22, `npm test` exits non-zero with ~8 pre-existing test failures (unrelated to this work — `ERR_MODULE_NOT_FOUND` for `.ts` imports, missing `vitest`, plus older flaky tests). **This is the baseline.** Do NOT treat the broken `npm test` as our gate — Tasks 7 and 8 below run only the new test file via a targeted command. If the baseline is unexpectedly green, great — record that and run `npm test` at the end as a bonus sanity check.

---

## Task 1: Patch `users.role` union (add `"owner"`)

**Files:**
- Modify: `convex/schema.ts:18-23`
- Test: `convex/lib/__tests__/schemaShape.test.ts` (created in Task 7)

This is the smallest possible widening — additive, backward-compatible. Doing it first reduces risk for everything downstream.

- [ ] **Step 1: Edit the role union**

  In `convex/schema.ts`, locate the `users` table definition (around line 13). Modify the `role` field:

  ```ts
  role: v.union(
    v.literal("cleaner"),
    v.literal("manager"),
    v.literal("property_ops"),
    v.literal("admin"),
    v.literal("owner"),       // ← NEW
  ),
  ```

- [ ] **Step 2: Run typecheck**

  ```bash
  npx tsc --noEmit
  ```

  Expected: PASS. If failures, they will surface in callers that switch on `role` exhaustively — note them; **Task 1.5** is the dedicated task for those fixes.

- [ ] **Step 3: Commit**

  ```bash
  git add convex/schema.ts
  git commit -m "feat(schema): widen users.role union to include \"owner\""
  ```

---

## Task 1.5: Handle exhaustive `users.role` switches in opscentral

**Files:** Discover via grep; modify as needed.

Widening `users.role` will TypeScript-fail any `switch` statement that exhaustively matches the old 4-value union without a `default` branch. Catch and fix these in the opscentral repo BEFORE Task 8's typecheck (which is the gate). The cleaners-app side is handled in Task 9.

- [ ] **Step 1: Find exhaustive role switches**

  ```bash
  grep -rn -E 'case\s+"(admin|cleaner|manager|property_ops)"' src/ convex/ 2>/dev/null | head -30
  grep -rn -E 'role:\s*"(admin|cleaner|manager|property_ops)"' src/ convex/ 2>/dev/null | head -30
  ```

  For each hit, open the file and judge: is this an exhaustive `switch` on a `role` discriminated union? Or just a literal comparison? Only the former needs a fix.

- [ ] **Step 2: For each exhaustive switch found, add an explicit owner handler**

  Two patterns are acceptable depending on context:

  (a) **The site is admin/staff routing** (e.g., role-based dashboard route map) — add `case "owner":` returning the owner dashboard route OR returning `null`/redirect-to-mobile for the cleaners-side. Each call site decides.

  (b) **The site is auth gating** — add `case "owner":` returning the appropriate access decision (likely `false` if the gate is for non-owner features).

  Document each fix in the commit message.

- [ ] **Step 3: Typecheck**

  ```bash
  npx tsc --noEmit
  ```

  Expected: PASS. If still failing on a `role` union, that grep missed a case — iterate.

- [ ] **Step 4: Commit (if any fixes were needed)**

  ```bash
  git add -A
  git commit -m "fix: handle users.role=\"owner\" in N exhaustive switches"
  ```

  Skip this commit if grep found no exhaustive switches that needed fixing.

---

## Task 2: Patch `stays` (add `cancelledAt` and `cancellationSource`)

**Files:**
- Modify: `convex/schema.ts:231-265`

Required by §5 step 1 of the spec — the fee engine excludes cancelled stays from `grossRevenue`. Both fields are `v.optional` so every existing prod stay row stays valid without backfill.

- [ ] **Step 1: Add the two optional fields**

  In the `stays` table definition, after `currency: v.optional(v.string()),` and before `metadata: v.optional(v.any()),`, insert:

  ```ts
  // Owner-portal: cancellation marker. Engine excludes stays with
  // cancelledAt != null from grossRevenue. Populated by the Hospitable
  // webhook handler on RESERVATION_CANCELLED, or manually by ops.
  // Additive optional field — every existing row is valid without backfill.
  cancelledAt: v.optional(v.number()),
  cancellationSource: v.optional(v.string()),
  ```

- [ ] **Step 2: Run typecheck**

  ```bash
  npx tsc --noEmit
  ```

  Expected: PASS.

- [ ] **Step 3: Commit**

  ```bash
  git add convex/schema.ts
  git commit -m "feat(schema): add stays.cancelledAt + cancellationSource for owner-portal engine"
  ```

---

## Task 3: Port the 6 finance/cost tables (no owner-specific fields yet)

**Files:**
- Modify: `convex/schema.ts` (insert near the existing INVENTORY block, add to `defineSchema` export at bottom)
- Reference: `/Users/atem/sites/jnabusiness_solutions/archive/jna-bs-admin/convex/schema.ts:576-765`

Tables to port: `manualAdjustments`, `capitalExpenditures`, `costCategories` (with the new optional `bucket` field), `costItems`, `costTemplates`, `propertyCostItems` (with the new optional `receiptStorageIds` field). (Note: 6 table definitions, all under §3.1 of the spec — `monthlyCalculations` and `propertyMonthlySettings` are in Task 4.)

- [ ] **Step 1: Add a new section header before the EXPORT SCHEMA block**

  In `convex/schema.ts`, find the line that begins `// EXPORT SCHEMA` (currently around line 1620). Immediately before it, insert:

  ```ts
  // ═══════════════════════════════════════════════════════════════════════════════
  // OWNER PORTAL — FINANCE & COSTS (Wave 1; spec §3 + §4)
  // Ported verbatim from archive jna-bs-admin/convex/schema.ts. The owner-facing
  // queries/mutations land in Wave 3; this wave only adds storage.
  // ═══════════════════════════════════════════════════════════════════════════════
  ```

- [ ] **Step 2: Add `manualAdjustments`**

  Below that header, paste:

  ```ts
  const manualAdjustments = defineTable({
    month: v.string(),                        // "YYYY-MM"
    propertyId: v.optional(v.id("properties")),
    type: v.union(
      v.literal("revenue"),
      v.literal("expense"),
      v.literal("cash"),
    ),
    category: v.string(),
    amount: v.number(),
    reason: v.string(),
    createdBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_month", ["month"])
    .index("by_property", ["propertyId"]);
  ```

- [ ] **Step 3: Add `capitalExpenditures`**

  ```ts
  const capitalExpenditures = defineTable({
    propertyId: v.id("properties"),
    amount: v.number(),
    category: v.string(),
    description: v.string(),
    vendor: v.optional(v.string()),
    purchaseDate: v.number(),
    receiptStorageIds: v.array(v.id("_storage")),
    createdBy: v.optional(v.id("users")),
    approvedBy: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_property", ["propertyId"])
    .index("by_date", ["purchaseDate"]);
  ```

- [ ] **Step 4: Add `costCategories` (WITH the new optional `bucket` field)**

  Per spec §3.3 — `bucket` is `v.optional` during port. Wave 2 backfill assigns values; a follow-up PR narrows to required.

  ```ts
  const costCategories = defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
    icon: v.optional(v.string()),
    isFixed: v.boolean(),
    sortOrder: v.number(),
    // Owner-portal: bucket classification for statement rendering. Optional
    // during Wave 1 — Wave 2 backfill assigns a value to every row, then a
    // follow-up PR narrows to required. Until then, queries that need a
    // bucket value treat undefined as "fallback to name-based mapping."
    bucket: v.optional(v.union(
      v.literal("lease"),
      v.literal("cleaning"),
      v.literal("supplies"),
      v.literal("utilities"),
      v.literal("maintenance"),
      v.literal("lawnPoolOutdoor"),
      v.literal("platformFees"),
      v.literal("subscriptions"),
      v.literal("labor"),
      v.literal("insurance"),
      v.literal("taxes"),
      v.literal("managementFee"),
      v.literal("other"),
    )),
    createdAt: v.number(),
  })
    .index("by_name", ["name"])
    .index("by_order", ["sortOrder"])
    .index("by_bucket", ["bucket"]);
  ```

- [ ] **Step 5: Add `costItems` and `costTemplates`**

  ```ts
  const costItems = defineTable({
    categoryId: v.id("costCategories"),
    name: v.string(),
    description: v.optional(v.string()),
    defaultAmount: v.optional(v.number()),
    isActive: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_category", ["categoryId"])
    .index("by_active", ["isActive"]);

  const costTemplates = defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    isDefault: v.boolean(),
    isActive: v.optional(v.boolean()),
    items: v.array(v.object({
      categoryId: v.string(),
      itemName: v.string(),
      amount: v.number(),
    })),
    createdBy: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_default", ["isDefault"])
    .index("by_name", ["name"]);
  ```

- [ ] **Step 6: Add `propertyCostItems` (WITH new optional `receiptStorageIds`)**

  ```ts
  const propertyCostItems = defineTable({
    propertyId: v.id("properties"),
    categoryId: v.id("costCategories"),
    costItemId: v.optional(v.id("costItems")),
    name: v.string(),
    amount: v.number(),
    frequency: v.union(
      v.literal("one_time"),
      v.literal("monthly"),
      v.literal("quarterly"),
      v.literal("annual"),
      v.literal("yearly"),
      v.literal("per_booking"),
      v.literal("revenue_percentage"),
    ),
    percentageRate: v.optional(v.number()),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    isActive: v.boolean(),
    // Owner-portal: receipts that back this cost line. Optional so existing
    // prod rows remain valid; UI renders [] and undefined identically.
    receiptStorageIds: v.optional(v.array(v.id("_storage"))),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_property", ["propertyId"])
    .index("by_category", ["categoryId"]);
  ```

- [ ] **Step 7: Run typecheck**

  ```bash
  npx tsc --noEmit
  ```

  Expected: PASS. If `v.union` rejects 13-arm enum (unlikely but worth knowing), reduce by combining; flag to spec owner.

- [ ] **Step 8: Commit**

  ```bash
  git add convex/schema.ts
  git commit -m "feat(schema): port finance tables from archive (manualAdjustments, capitalExpenditures, costs)"
  ```

---

## Task 4: Port `monthlyCalculations` and `propertyMonthlySettings`

**Files:**
- Modify: `convex/schema.ts` (continue in the OWNER PORTAL section)
- Reference: archive `convex/schema.ts:616-659` and `:1279-1314`

- [ ] **Step 1: Add `monthlyCalculations`**

  Verbatim from archive. Below the cost tables added in Task 3:

  ```ts
  const monthlyCalculations = defineTable({
    propertyId: v.id("properties"),
    month: v.string(),
    grossRevenue: v.number(),
    platformFees: v.number(),
    netRevenue: v.number(),
    totalCosts: v.number(),
    costBreakdown: v.optional(v.any()),
    netProfit: v.number(),
    marginPercent: v.optional(v.number()),
    occupancyRate: v.optional(v.number()),
    totalNights: v.optional(v.number()),
    bookedNights: v.optional(v.number()),
    scenarioName: v.optional(v.string()),
    isActual: v.optional(v.boolean()),
    totalBookings: v.optional(v.number()),
    totalDays: v.optional(v.number()),
    profitOptimization: v.optional(v.any()),
    optimizationSource: v.optional(v.string()),
    damageCost: v.optional(v.number()),
    claimsReceived: v.optional(v.number()),
    netDamageImpact: v.optional(v.number()),
    adjustedProfit: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_property", ["propertyId"])
    .index("by_month", ["month"])
    .index("by_property_month", ["propertyId", "month"]);
  ```

- [ ] **Step 2: Add `propertyMonthlySettings`**

  ```ts
  const propertyMonthlySettings = defineTable({
    propertyId: v.id("properties"),
    month: v.string(),
    settings: v.object({
      cleaningModel: v.optional(v.union(v.literal("percent"), v.literal("flat_cap"))),
      cleaningPercent: v.optional(v.number()),
      cleaningFlatCap: v.optional(v.number()),
      utilitiesOverride: v.optional(v.number()),
      customCosts: v.optional(v.array(v.object({
        name: v.string(),
        amount: v.number(),
      }))),
    }),
    configurationName: v.optional(v.string()),
    monthlyBookingsAssumption: v.optional(v.number()),
    totalRevenueAssumption: v.optional(v.number()),
    occupancyRateAssumption: v.optional(v.number()),
    avgBookingValueAssumption: v.optional(v.number()),
    notes: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    bookedNights: v.optional(v.number()),
    importSource: v.optional(v.string()),
    externalPropertyId: v.optional(v.string()),
    damageCost: v.optional(v.number()),
    claimsReceived: v.optional(v.number()),
    createdBy: v.optional(v.id("users")),
    updatedBy: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_property", ["propertyId"])
    .index("by_property_month", ["propertyId", "month"]);
  ```

- [ ] **Step 3: Typecheck and commit**

  ```bash
  npx tsc --noEmit
  git add convex/schema.ts
  git commit -m "feat(schema): port monthlyCalculations + propertyMonthlySettings from archive"
  ```

---

## Task 5: Add the 6 net-new owner-portal tables

**Files:**
- Modify: `convex/schema.ts` (continue in the OWNER PORTAL section)
- Reference: spec §4

Each table is straightforward — just translating the spec to Convex validators.

**⚠️ ORDERING IS LOAD-BEARING in this task.** `v.id("propertyOwners")` and `v.id("propertyFeeConfig")` references inside `ownerStatements` and `maintenanceApprovalRequests` require the referenced `const` declarations to appear EARLIER in the file. Insert the table definitions in the literal order given in the steps below (1 → 6). Do NOT alphabetize, do NOT reorder for tidiness — Convex resolves these by lexical position, not by `defineSchema` registration.

- [ ] **Step 1: Add `propertyOwners`**

  ```ts
  const propertyOwners = defineTable({
    propertyId: v.id("properties"),
    userId: v.id("users"),
    stakePct: v.number(),
    role: v.union(v.literal("landlord"), v.literal("investor")),
    isPrimaryApprover: v.boolean(),
    effectiveFrom: v.number(),
    effectiveTo: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_property", ["propertyId"])
    .index("by_user", ["userId"])
    .index("by_property_and_effective", ["propertyId", "effectiveFrom"])
    .index("by_user_and_active", ["userId", "effectiveTo"]);
  ```

- [ ] **Step 2: Add `propertyFeeConfig`**

  ```ts
  const propertyFeeConfig = defineTable({
    propertyId: v.id("properties"),
    feePct: v.number(),
    feeBase: v.union(
      v.literal("grossRevenue"),
      v.literal("netRevenue"),
      v.literal("netOperatingProfit"),
    ),
    approvalThreshold: v.number(),
    autoApproveAfterDays: v.optional(v.number()),
    effectiveFrom: v.number(),
    effectiveTo: v.optional(v.number()),
    createdBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_property", ["propertyId"])
    .index("by_property_and_effective", ["propertyId", "effectiveFrom"]);
  ```

- [ ] **Step 3: Add `ownerStatements`**

  Long but mechanical. Includes the `pdfStorageId` + `pdfTemplateVersion` fields locked in §13b.

  ```ts
  const ownerStatements = defineTable({
    propertyId: v.id("properties"),
    periodStart: v.number(),
    periodEnd: v.number(),
    status: v.union(v.literal("draft"), v.literal("issued")),
    snapshotTotals: v.object({
      grossRevenue: v.number(),
      platformFees: v.number(),
      netRevenue: v.number(),
      costsByBucket: v.array(v.object({
        bucket: v.string(),
        amount: v.number(),
      })),
      operatingCosts: v.number(),
      noi: v.number(),
      feeBase: v.union(
        v.literal("grossRevenue"),
        v.literal("netRevenue"),
        v.literal("netOperatingProfit"),
      ),
      feePct: v.number(),
      mgmtFee: v.number(),
      ownerPayout: v.number(),
      capExMemo: v.number(),
      perOwner: v.array(v.object({
        ownerId: v.id("propertyOwners"),
        userId: v.id("users"),
        stakePct: v.number(),
        payout: v.number(),
      })),
    }),
    feeConfigSnapshot: v.object({
      feeConfigId: v.id("propertyFeeConfig"),
      feePct: v.number(),
      feeBase: v.string(),
      effectiveFrom: v.number(),
    }),
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
        amount: v.number(),
      }),
      v.object({
        table: v.literal("capitalExpenditures"),
        rowId: v.id("capitalExpenditures"),
        amount: v.number(),
      }),
    )),
    issuedAt: v.optional(v.number()),
    issuedBy: v.optional(v.id("users")),
    pdfStorageId: v.optional(v.id("_storage")),
    pdfTemplateVersion: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_property", ["propertyId"])
    .index("by_property_and_period", ["propertyId", "periodStart"])
    .index("by_status", ["status"]);
  ```

- [ ] **Step 4: Add `maintenanceApprovalRequests`**

  ```ts
  const maintenanceApprovalRequests = defineTable({
    propertyId: v.id("properties"),
    ownerId: v.id("propertyOwners"),
    proposedCost: v.number(),
    description: v.string(),
    photoIds: v.array(v.id("photos")),
    requestedBy: v.id("users"),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("declined"),
      v.literal("auto_approved"),
    ),
    decidedAt: v.optional(v.number()),
    decidedBy: v.optional(v.id("users")),
    decidedNote: v.optional(v.string()),
    resultingCostItemId: v.optional(v.id("propertyCostItems")),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_property", ["propertyId"])
    .index("by_owner", ["ownerId"])
    .index("by_status", ["status"])
    .index("by_property_and_status", ["propertyId", "status"]);
  ```

- [ ] **Step 5: Add `ownerDateBlocks`**

  ```ts
  const ownerDateBlocks = defineTable({
    propertyId: v.id("properties"),
    ownerId: v.id("propertyOwners"),
    startDate: v.number(),
    endDate: v.number(),
    note: v.optional(v.string()),
    syncedToChannelsAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_property", ["propertyId"])
    .index("by_owner", ["ownerId"])
    .index("by_property_and_start", ["propertyId", "startDate"]);
  ```

- [ ] **Step 6: Add `ownerNotificationPrefs`**

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

- [ ] **Step 7: Typecheck and commit**

  ```bash
  npx tsc --noEmit
  git add convex/schema.ts
  git commit -m "feat(schema): add 6 owner-portal tables (owners, feeConfig, statements, approvals, blocks, prefs)"
  ```

---

## Task 6: Widen `notifications.type` union for owner events

**Files:**
- Modify: `convex/schema.ts:1118-1129`

Per spec §11. Additive — no existing row is invalidated.

- [ ] **Step 1: Add three literals to the union**

  In the `notifications` table, modify `type`:

  ```ts
  type: v.union(
    v.literal("job_assigned"),
    v.literal("job_at_risk"),
    v.literal("job_completed"),
    v.literal("awaiting_approval"),
    v.literal("rework_required"),
    v.literal("incident_created"),
    v.literal("low_stock"),
    v.literal("message_received"),
    v.literal("task_assigned"),
    v.literal("system"),
    v.literal("owner_statement_issued"),    // ← NEW
    v.literal("owner_approval_request"),    // ← NEW
    v.literal("owner_incident_reported"),   // ← NEW
  ),
  ```

- [ ] **Step 2: Typecheck and commit**

  ```bash
  npx tsc --noEmit
  git add convex/schema.ts
  git commit -m "feat(schema): widen notifications.type for owner-portal events"
  ```

---

## Task 7: Register all new tables in the schema export + add shape test

**Files:**
- Modify: `convex/schema.ts:1624-1711` (the `export default defineSchema({...})` block)
- Create: `convex/lib/schemaShape.test.ts` (next to source per repo convention — see `convex/lib/companyScope.test.ts`)
- Create: `convex/owner/README.md`

The new tables must be added to the `defineSchema({...})` object literal at the bottom of the file or Convex will not register them.

**Test runner note:** `npm test` is currently broken on main (see Pre-flight 4). We invoke our new test directly via `node --experimental-strip-types --test convex/lib/schemaShape.test.ts` — same pattern as `package.json`'s `sync-tokens` script. This sidesteps the broken baseline and gives a clean PASS/FAIL signal for the new test only.

- [ ] **Step 1: Write the failing test FIRST**

  Create `convex/lib/schemaShape.test.ts`. The test imports the schema (`.ts` extension required for `--experimental-strip-types`) and asserts every new table is registered:

  ```ts
  import { test } from "node:test";
  import assert from "node:assert/strict";
  import schema from "../schema.ts";

  const OWNER_PORTAL_TABLES = [
    "manualAdjustments",
    "capitalExpenditures",
    "costCategories",
    "costItems",
    "costTemplates",
    "propertyCostItems",
    "monthlyCalculations",
    "propertyMonthlySettings",
    "propertyOwners",
    "propertyFeeConfig",
    "ownerStatements",
    "maintenanceApprovalRequests",
    "ownerDateBlocks",
    "ownerNotificationPrefs",
  ];

  test("owner-portal Wave 1 tables are registered in defineSchema", () => {
    const registered = Object.keys((schema as any).tables);
    for (const name of OWNER_PORTAL_TABLES) {
      assert.ok(
        registered.includes(name),
        `expected table "${name}" to be registered in convex/schema.ts defineSchema({...}) export`,
      );
    }
  });

  test("schema includes the three owner-portal notification literals", () => {
    const notificationsTable = (schema as any).tables.notifications;
    const validatorJson = JSON.stringify(notificationsTable);
    for (const literal of [
      "owner_statement_issued",
      "owner_approval_request",
      "owner_incident_reported",
    ]) {
      assert.ok(
        validatorJson.includes(literal),
        `expected notifications.type union to include "${literal}"`,
      );
    }
  });

  test("schema includes the \"owner\" role literal", () => {
    const usersTable = (schema as any).tables.users;
    assert.ok(
      JSON.stringify(usersTable).includes("owner"),
      "expected users.role union to include \"owner\"",
    );
  });
  ```

- [ ] **Step 2: Run the test to verify it FAILS**

  ```bash
  node --experimental-strip-types --test convex/lib/schemaShape.test.ts
  ```

  Expected: FAIL on the first test case ("owner-portal Wave 1 tables are registered…") — table names are missing from `defineSchema` because we have not yet added them. The "owner" role and notification-literals checks should already PASS (Tasks 1 and 6 added those). Step 3 fixes the first case. If it accidentally passes, recheck that the new tables are NOT in the export yet — we want to see the failure first.

- [ ] **Step 3: Add all 14 new tables to the `defineSchema` export**

  In `convex/schema.ts`, locate `export default defineSchema({ ... });` at the bottom. Add a new block (preserve existing entries):

  ```ts
  export default defineSchema({
    // ... all existing entries unchanged ...

    // Owner Portal — Wave 1 (spec §3 + §4)
    manualAdjustments,
    capitalExpenditures,
    costCategories,
    costItems,
    costTemplates,
    propertyCostItems,
    monthlyCalculations,
    propertyMonthlySettings,
    propertyOwners,
    propertyFeeConfig,
    ownerStatements,
    maintenanceApprovalRequests,
    ownerDateBlocks,
    ownerNotificationPrefs,
  });
  ```

- [ ] **Step 4: Re-run the test to verify it PASSES**

  ```bash
  node --experimental-strip-types --test convex/lib/schemaShape.test.ts
  ```

  Expected: PASS on all three test cases.

- [ ] **Step 4.5: Create `convex/owner/constants.ts`** — canonical bucket list + derived type

  ```ts
  // Canonical list of cost-statement buckets. Source of truth for any code
  // that writes `costCategories.bucket`. The schema in convex/schema.ts uses
  // v.optional(v.union(...)) of these exact literals during Wave 1 (so
  // existing prod rows without a bucket value remain valid). A follow-up PR
  // post-Wave 2 backfill narrows that union to required.
  //
  // Until the narrowing PR lands, every writing path MUST validate against
  // BUCKETS.includes(value) at the mutation boundary. Defense-in-depth
  // against ad-hoc Convex-shell writes or future contributors bypassing the
  // typed union.
  export const BUCKETS = [
    "lease",
    "cleaning",
    "supplies",
    "utilities",
    "maintenance",
    "lawnPoolOutdoor",
    "platformFees",
    "subscriptions",
    "labor",
    "insurance",
    "taxes",
    "managementFee",
    "other",
  ] as const;

  export type Bucket = (typeof BUCKETS)[number];

  export function isBucket(value: unknown): value is Bucket {
    return typeof value === "string" && (BUCKETS as readonly string[]).includes(value);
  }
  ```

- [ ] **Step 5: Create `convex/owner/README.md`**

  One-page subsystem explainer. Just a pointer + table list — no code.

  ```markdown
  # Convex `owner/` — Property Owner Portal subsystem

  This directory holds queries, mutations, and actions for the owner-facing
  product surface. **Wave 1 is schema-only** — the tables defined here exist in
  `convex/schema.ts` but have no callable functions yet.

  ## Spec
  - Design: `docs/superpowers/specs/2026-05-22-property-owner-portal-design.md`
  - Wave plan: `docs/superpowers/plans/2026-05-22-property-owner-portal-plan.md`

  ## Tables (Wave 1)
  - Ported from archive: `manualAdjustments`, `capitalExpenditures`,
    `costCategories`, `costItems`, `costTemplates`, `propertyCostItems`,
    `monthlyCalculations`, `propertyMonthlySettings`
  - Net-new for owner portal: `propertyOwners`, `propertyFeeConfig`,
    `ownerStatements`, `maintenanceApprovalRequests`, `ownerDateBlocks`,
    `ownerNotificationPrefs`

  ## Canonical constants
  - `constants.ts` — `BUCKETS` array + `Bucket` type + `isBucket()` guard.
    Until the post-Wave-2 narrowing PR, every writer to
    `costCategories.bucket` MUST validate via `isBucket(value)` at the
    mutation boundary.

  ## Coming in later waves
  - Wave 2: cost-data backfill (one-time mutation, then PR to narrow
    `costCategories.bucket` to required).
  - Wave 3: fee engine + queries (`getOwnerStatementDraft`,
    `issueOwnerStatement`, `decideMaintenanceApprovalRequest`, etc.).
  - Wave 4: `/owner/*` web routes.
  - Wave 5: `(owner)` mobile route group.

  ## Deployment ownership
  This Convex backend is owned by `opscentral-admin`. **NEVER** run
  `npx convex deploy` from `jna-cleaners-app`. See workspace `CLAUDE.md`.
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add convex/schema.ts convex/lib/schemaShape.test.ts convex/owner/README.md convex/owner/constants.ts
  git commit -m "feat(schema): register owner-portal tables in defineSchema + add shape test + BUCKETS constants"
  ```

---

## Task 8: Validate schema accepts on Convex dev deployment + regenerate codegen

**Files:**
- Auto-regen: `convex/_generated/*`

This is the first real Convex validation. Push the schema to the dev sandbox (`usable-anaconda-394`) — NOT prod. If Convex's schema validator rejects (e.g., a malformed `v.union`, a `_storage` reference that's wrong), we discover it here.

- [ ] **Step 1: Regenerate codegen (pure local — no deployment push)**

  ```bash
  cd /Users/atem/sites/jnabusiness_solutions/apps-ja/opscentral-admin/.claude/worktrees/jovial-beaver-24e853
  npx convex codegen
  ```

  Expected: writes updated files into `convex/_generated/`. Pure local — does not touch any deployment. If the CLI rejects the schema here (e.g., a malformed `v.union`, a typo in a literal), the error message names the offending field path — fix and re-run.

- [ ] **Step 2: Push schema to the dev sandbox to catch deployment-time validation errors**

  ```bash
  npx convex dev --once
  ```

  (If `--once` is unsupported in your installed CLI version, run `npx convex dev`, wait for "Convex functions ready!" or "Schema is up to date", then Ctrl-C.)

  Expected: schema accepted on `usable-anaconda-394` (the dev sandbox per spec §1, NOT prod). This is where `v.id("_storage")` and other validator shapes get real-deployment validation. If you see "Schema rejected" with a field path, that's the field to fix.

- [ ] **Step 3: Confirm `_generated` files were updated**

  ```bash
  git status convex/_generated/
  ```

  Expected: changes in `api.d.ts`, `api.js`, `dataModel.d.ts`. If no changes, codegen didn't run — investigate before continuing.

- [ ] **Step 4: Re-run the targeted shape test against the regenerated schema**

  ```bash
  node --experimental-strip-types --test convex/lib/schemaShape.test.ts
  ```

  Expected: PASS, all three cases. (Do NOT run `npm test` here — pre-existing failures unrelated to this work would give a false-fail signal. See Pre-flight 4.)

- [ ] **Step 5: Run lint**

  ```bash
  npm run lint
  ```

  Expected: PASS. (If lint flags the README or unused imports in `schema.ts`, fix.)

- [ ] **Step 6: Commit regenerated files**

  ```bash
  git add convex/_generated
  git commit -m "chore(convex): regenerate codegen after Wave 1 schema additions"
  ```

---

## Task 9: Sync schema to cleaners-app and validate sibling typecheck

**Files (in sibling repo):**
- Auto-replace: `/Users/atem/sites/jnabusiness_solutions/apps-ja/jna-cleaners-app/convex/schema.ts`
- Auto-regen: `/Users/atem/sites/jnabusiness_solutions/apps-ja/jna-cleaners-app/convex/_generated/*`

This is the lockstep step. The cleaners app must typecheck against the new schema BEFORE we deploy opscentral to prod, or the next mobile build breaks. Per spec §12 step 3 — the cleaners PR cannot merge before opscentral's, and opscentral cannot deploy until cleaners has the new generated types in main.

- [ ] **Step 1: From the sibling cleaners-app checkout, run the sync script**

  ```bash
  cd /Users/atem/sites/jnabusiness_solutions/apps-ja/jna-cleaners-app
  git status --short    # confirm clean tree
  git checkout -b task/owner-portal-wave1-schema-mirror
  npm run sync:convex-backend
  ```

  Expected: `convex/schema.ts` updated to match opscentral's new version. The script also regenerates `_generated/*` types.

- [ ] **Step 2: Typecheck the cleaners app against the widened schema**

  ```bash
  cd /Users/atem/sites/jnabusiness_solutions/apps-ja/jna-cleaners-app
  npx tsc --noEmit
  ```

  Expected: PASS. The two unions that widened (`users.role` adding `"owner"` and `notifications.type` adding three new literals) are additive — existing exhaustive `switch` statements on these unions will TypeScript-fail.

  **If failures appear** in mobile-app role guards or notification handlers: add a `default:` case that no-ops or routes unknown notification types to a generic handler. Do NOT remove the new literals from this repo's schema — they belong in the source of truth. Commit those fixes in a separate commit within the cleaners PR.

- [ ] **Step 3: Run cleaners-app tests (per its own conventions)**

  ```bash
  cd /Users/atem/sites/jnabusiness_solutions/apps-ja/jna-cleaners-app
  npm test
  ```

  Expected: PASS — OR pre-existing failures matching the cleaners-app's baseline (record any baseline failures observed pre-edit; new failures attributable to this change must be investigated). If cleaners-app `npm test` is also broken on its main, treat the typecheck in Step 2 as the gate.

- [ ] **Step 4: Commit the cleaners-app mirror AND push the branch immediately**

  ```bash
  cd /Users/atem/sites/jnabusiness_solutions/apps-ja/jna-cleaners-app
  git add convex/schema.ts convex/_generated
  # add any exhaustive-switch fix files too
  git commit -m "chore(convex): mirror opscentral Wave 1 owner-portal schema"
  git push -u origin task/owner-portal-wave1-schema-mirror
  ```

  Push immediately (without opening a PR yet — that's Task 10) to durably preserve the lockstep state. If this session ends between Task 9 and Task 10, the branch is safe on the remote.

- [ ] **Step 5: Rollback note (read, don't run)**

  If a later step (e.g., a deploy-time schema rejection in Task 10) forces aborting Wave 1:

  ```bash
  # In cleaners-app, undo the mirror commit and force-delete the branch
  cd /Users/atem/sites/jnabusiness_solutions/apps-ja/jna-cleaners-app
  git checkout main
  git branch -D task/owner-portal-wave1-schema-mirror
  git push origin --delete task/owner-portal-wave1-schema-mirror
  ```

  Do the same on the opscentral side via the worktree's branch. **Both rollbacks must happen together** — a half-rolled-back state leaves either repo seeing a phantom schema mismatch.

---

## Task 10: Open lockstep PRs (do NOT deploy)

**Files:** PR descriptions only

This task creates two PRs but DOES NOT MERGE or DEPLOY. Deployment is human-gated per project safety rules — the spec author (you, the user reading this) reviews + decides.

- [ ] **Step 1: Push the opscentral branch**

  ```bash
  cd /Users/atem/sites/jnabusiness_solutions/apps-ja/opscentral-admin/.claude/worktrees/jovial-beaver-24e853
  git push -u origin HEAD
  ```

- [ ] **Step 2: Open the opscentral PR**

  ```bash
  gh pr create --title "feat(schema): owner-portal Wave 1 — additive schema migration" --body "$(cat <<'EOF'
  ## Summary
  - Ports 8 finance/cost tables from archive `jna-bs-admin/convex/schema.ts` (spec §3.1)
  - Adds 6 net-new owner-portal tables (spec §4)
  - Widens `users.role` union to include `"owner"`
  - Widens `notifications.type` union for three new owner-portal event types
  - Adds `stays.cancelledAt` + `cancellationSource` (optional, additive)
  - All changes are additive — every existing prod row remains valid

  No queries, mutations, or UI changes in this PR. Those land in Waves 2–5.

  ## Lockstep
  This PR must merge ALONGSIDE the cleaners-app mirror PR — see `jna-cleaners-app/PR #...`. Do NOT deploy to prod (`lovable-oriole-182`) until BOTH PRs are merged and cleaners has `npm run sync:convex-backend` regenerated in main.

  ## Test plan
  - [x] `npx tsc --noEmit` clean in this repo
  - [x] `npm test` clean (including new schema-shape tests in `convex/lib/__tests__/schemaShape.test.ts`)
  - [x] `npx convex dev --once` accepted schema against dev sandbox (`usable-anaconda-394`)
  - [ ] `npx tsc --noEmit` clean in cleaners-app after `npm run sync:convex-backend` (see sibling PR)
  - [ ] Deploy to prod from this repo: `CONVEX_DEPLOY_KEY=\$PROD_CONVEX_DEPLOY_KEY npx convex deploy` — gated on human approval after both PRs merge

  ## Spec / plan
  - Spec: `docs/superpowers/specs/2026-05-22-property-owner-portal-design.md`
  - Plan: `docs/superpowers/plans/2026-05-22-property-owner-portal-plan.md`

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  EOF
  )"
  ```

  Record the PR URL.

- [ ] **Step 3: Open the cleaners-app mirror PR** (branch already pushed in Task 9 Step 4)

  ```bash
  cd /Users/atem/sites/jnabusiness_solutions/apps-ja/jna-cleaners-app
  gh pr create --title "chore(convex): mirror opscentral owner-portal Wave 1 schema" --body "$(cat <<'EOF'
  ## Summary
  Mirror of the opscentral owner-portal Wave 1 schema additions. Generated by `npm run sync:convex-backend`. No business-logic changes here — only `convex/schema.ts` replacement + regenerated `_generated/*` types.

  ## Lockstep
  This PR pairs with `opscentral-admin PR #...`. Both must merge before opscentral deploys to prod, or the next mobile build breaks on the widened `users.role` and `notifications.type` unions.

  ## Test plan
  - [x] `npx tsc --noEmit` clean in cleaners app
  - [x] `npm test` clean in cleaners app
  - [ ] No mobile UX change expected — Wave 5 introduces the `(owner)` route group

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  EOF
  )"
  ```

  Record the PR URL.

- [ ] **Step 4: Cross-link the PRs**

  Edit each PR's body to replace the `#...` placeholder with the actual sibling PR URL using `gh pr edit`.

- [ ] **Step 5: STOP — hand off to human for review + deploy**

  Report to the user:
  - The two PR URLs
  - A reminder that prod deployment (`npx convex deploy` from opscentral) is human-gated per project safety rules
  - That the deploy sequence is: merge both PRs → re-run sync in cleaners main → deploy opscentral → ship cleaners build
  - That Wave 2 (cost-data backfill) is the next plan to generate, gated on Wave 1 being live in prod

---

## Wave 1 Acceptance Criteria

When all 10 tasks are checked:

- [ ] `convex/schema.ts` typechecks cleanly with all 14 owner-portal tables registered
- [ ] `npm test` passes including the new `convex/lib/__tests__/schemaShape.test.ts`
- [ ] `npx convex dev --once` accepts the schema against the dev sandbox
- [ ] Cleaners-app sibling repo typechecks cleanly after `npm run sync:convex-backend`
- [ ] Two cross-linked PRs are open (opscentral + cleaners) awaiting human review
- [ ] No queries, mutations, or UI exist yet — that's correct; Wave 1 is schema-only
- [ ] Existing prod traffic is unaffected — every change was additive

## What's NOT in this plan (intentional)

| Item | Lives in |
|---|---|
| Backfill of `costCategories.bucket` + re-bucketing of misfiled prod cost items | **Wave 2 plan** (generate after Wave 1 is in prod) |
| `convex/owner/auth.ts` (`assertOwnerOfProperty`, `withOwnerAuth` wrapper) | Wave 3 plan |
| Fee engine (`computeStatementForPeriod`), draft + issue mutations, all owner-facing queries | Wave 3 plan |
| Server-rendered PDF action (`renderOwnerStatementPdf`) + template versioning | Wave 3 plan |
| Maintenance auto-approval cron | Wave 3 plan |
| `/owner/*` web routes + responsive PWA shell | Wave 4 plan |
| `(owner)` mobile route group in cleaners-app | Wave 5 plan (slip-able per spec §8) |
| Tightening `costCategories.bucket` from `v.optional` to required | Follow-up PR post-Wave 2, gated on backfill audit log |
