# Fix: Owner Statement Draft "Server Error" (Tataw / new-owner onboarding) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the owner property page from crashing with "Server Error" when the fee engine can't compute a month, repair Tataw's data so his page works today, and make new-owner onboarding backdate the first fee config so this class of bug can't recur.

**Architecture:** Three independent layers. (A) One-command prod data repair using the existing `backdateOwnerSeed` internal mutation. (B) `getOwnerStatementDraft` adopts the same `draft: FeeEngineOutput | { error: string }` envelope that `getOwnerDashboard` already returns per property, and the web client adopts the same `"totals" in draft` guard the dashboard already uses. The mobile app **already handles this envelope** — zero mobile code changes. (C) `upsertPropertyFeeConfig` / `upsertPropertyOwners` default `effectiveFrom` to the property's first-activity month (instead of `now`) **only when inserting the first-ever row** for a property; subsequent upserts keep append-only `effectiveFrom=now` versioning.

**Tech Stack:** Convex (queries/mutations in `convex/`), Next.js 16 client components, Tailwind CSS v4, `node --test` (Node 22 native TS type-stripping).

---

## Root cause (verified against prod `lovable-oriole-182`, 2026-07-04)

**Symptom:** Owner Tataw John signs in at `app.chezsoistays.com/owner/properties/rs7892htyjbe7x7yxg39frbqr9853zyb?month=2026-06` → full-page error boundary: `[CONVEX Q(owner/queries:getOwnerStatementDraft)] Server Error`.

**Verified chain:**

1. Tataw was onboarded as owner of this property on **2026-07-04 ~05:52 UTC** (this morning). The admin flow calls `upsertPropertyFeeConfig` / `upsertPropertyOwners` ([convex/owner/mutations.ts:47](../convex/owner/mutations.ts) / [:91](../convex/owner/mutations.ts)), which insert with `effectiveFrom: now`. His property's **only** `propertyFeeConfig` row has `effectiveFrom = 1783144331602` (Jul 4 2026). Every *other* property's config is backdated to `1735689600000` (Jan 1 2026) — Tataw's is the outlier.
2. `pickFeeConfigForPeriod` ([convex/owner/feeEngine.ts:194-213](../convex/owner/feeEngine.ts)) requires a config active at `periodStart`. For `month=2026-06` (periodStart Jun 1) — and even for `2026-07` (periodStart Jul 1 < Jul 4!) — none is active, so it throws a **plain `Error`** (not `ConvexError`): `No propertyFeeConfig active at periodStart=1780272000000...`. Convex redacts plain errors to "Server Error" on the client. **The page is broken for every month until 2026-08.**
3. `getOwnerStatementDraft` ([convex/owner/queries.ts:265-278](../convex/owner/queries.ts)) is the **only** owner query that does not catch engine errors — `getOwnerDashboard` (line 70-76) and `getOwnerMortgageCoverage` (line 600-610) both wrap the engine in try/catch and return an error envelope. The uncaught throw kills the whole `useQuery` → React error boundary replaces the page.

**Reproduce (read-only):**
```bash
cd /Users/atem/sites/jnabusiness_solutions/apps-ja/opscentral-admin
export $(grep -v '^#' .env.local | grep PROD_CONVEX_DEPLOY_KEY | xargs)
CONVEX_DEPLOY_KEY="$PROD_CONVEX_DEPLOY_KEY" npx convex run \
  owner/queries:debugEngineBreakdown \
  '{"propertyId":"rs7892htyjbe7x7yxg39frbqr9853zyb","month":"2026-06"}'
# → { "error": "No propertyFeeConfig active at periodStart=1780272000000. ..." }
```

**Related but separate:** [Docs/2026-07-04-owner-consistency-plan.md](2026-07-04-owner-consistency-plan.md) covers the Team-page/Owner-Overview/Monthly-Close drift for the same user. Do NOT merge scopes; this plan is only the statement-draft crash.

## Global Constraints

- **Work in a worktree, never the main checkout.** Main checkout `apps-ja/opscentral-admin/` stays on `main` untouched (Tasks 1–3; Task 0 is a main-session data command, see below).
- **NEVER run** `npx convex deploy`, `npx convex dev`, `npx convex dev --once`, or `npx convex codegen` from the worktree. The main session deploys after merge (`.harness/convex.md`).
- **No schema changes** in this plan — no new tables, fields, or indexes. Return-shape change to `getOwnerStatementDraft` is backward-tolerated by mobile (already guards `!totals`).
- **TypeScript strict, no `any`.**
- **Tailwind v4 gotcha:** repo has no `@theme` block, so shadcn-named utilities (`bg-muted`, `text-muted-foreground`) generate **no CSS**. Use arbitrary-value syntax with CSS variables for new markup: `text-[var(--muted-foreground)]`.
- **Tests:** `npm test` runs `node --test`. Node 22 type-stripping lets `.test.mjs` import `.ts` modules **with an explicit `.ts` extension**. `convex/owner/feeEngine.ts` is pure (no db access, type-only imports) — safe to import directly.
- **Conventional commits.** Commit after every green task.
- Business logic lives in Convex, not React (repo rule #1).

---

### Task 0: Prod data repair — unblock Tataw immediately (MAIN SESSION ONLY, not the worktree agent)

⚠️ This is a **prod mutation** and must run from the main checkout with the prod deploy key. It backdates BOTH the `propertyOwners` row and the `propertyFeeConfig` row for the property. Decision baked in: backdate to **`1735689600000` (2026-01-01 UTC)** — the same convention every other property's rows use. (Business implication: Tataw's portal shows the property's full 2026 history; that matches the radical-transparency wedge and how Randalls' properties are configured.)

- [ ] **Step 1: Run the existing backdate repair mutation against prod**

```bash
cd /Users/atem/sites/jnabusiness_solutions/apps-ja/opscentral-admin
export $(grep -v '^#' .env.local | grep PROD_CONVEX_DEPLOY_KEY | xargs)
CONVEX_DEPLOY_KEY="$PROD_CONVEX_DEPLOY_KEY" npx convex run \
  owner/mutations:backdateOwnerSeed \
  '{"propertyId":"rs7892htyjbe7x7yxg39frbqr9853zyb","effectiveFrom":1735689600000}'
```
Expected output: `{ touchedOwners: 1, touchedConfigs: 1, newEffectiveFrom: 1735689600000 }`

- [ ] **Step 2: Verify the engine now computes June AND July**

```bash
CONVEX_DEPLOY_KEY="$PROD_CONVEX_DEPLOY_KEY" npx convex run \
  owner/queries:debugEngineBreakdown \
  '{"propertyId":"rs7892htyjbe7x7yxg39frbqr9853zyb","month":"2026-06"}'
CONVEX_DEPLOY_KEY="$PROD_CONVEX_DEPLOY_KEY" npx convex run \
  owner/queries:debugEngineBreakdown \
  '{"propertyId":"rs7892htyjbe7x7yxg39frbqr9853zyb","month":"2026-07"}'
```
Expected: both return `{ totals: {...}, feeConfigSnapshot: {...}, ... }` with **no `error` key**.

- [ ] **Step 3: Confirm in browser** — reload `app.chezsoistays.com/owner/properties/rs7892htyjbe7x7yxg39frbqr9853zyb?month=2026-06` as Tataw (or ask him). Page renders, no error boundary.

---

### Task 1: Worktree setup + engine-contract regression test

**Files:**
- Create: worktree at `~/sites/opscentral-admin-owner-draft-fix` on branch `task/owner-draft-engine-error`
- Test: `tests/fee-config-period.test.mjs`

**Interfaces:**
- Consumes: `pickFeeConfigForPeriod(configs, periodStart)` exported from [convex/owner/feeEngine.ts:195](../convex/owner/feeEngine.ts) — throws `Error` starting `"No propertyFeeConfig active at periodStart="` when nothing is active.
- Produces: a pinned test for that contract (Tasks 2's try/catch relies on the throw; this test stops someone "fixing" the engine to silently return undefined).

- [ ] **Step 1: Create the worktree** (all subsequent tasks run inside it)

```bash
cd /Users/atem/sites/jnabusiness_solutions/apps-ja/opscentral-admin
git fetch origin
git worktree add ~/sites/opscentral-admin-owner-draft-fix -b task/owner-draft-engine-error origin/main
cd ~/sites/opscentral-admin-owner-draft-fix && npm install
```

- [ ] **Step 2: Write the failing-throw test**

Create `tests/fee-config-period.test.mjs`:

```js
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
```

- [ ] **Step 3: Run it — must pass already (contract exists today)**

Run: `node --test tests/fee-config-period.test.mjs`
Expected: 3 passing. (If the import fails at runtime, check that only `import type` statements exist at the top of `feeEngine.ts` — it is documented as pure/no-db.)

- [ ] **Step 4: Commit**

```bash
git add tests/fee-config-period.test.mjs
git commit -m "test(owner): pin pickFeeConfigForPeriod active-window contract"
```

---

### Task 2: Graceful error envelope in `getOwnerStatementDraft` + web guard

**Files:**
- Modify: `convex/owner/queries.ts:264-278` (the `getOwnerStatementDraft` export)
- Modify: `src/components/owner/owner-property-client.tsx:234-248` (the `OverviewSummaryCard` block)

**Interfaces:**
- Consumes: `FeeEngineOutput` type (already imported at [queries.ts:29](../convex/owner/queries.ts)); `loadEngineInputs`, `computeStatementForPeriod` (already imported).
- Produces: `getOwnerStatementDraft` returns `{ month, periodStart, periodEnd, draft: FeeEngineOutput | { error: string } }`. This is the SAME union `getOwnerDashboard` returns per-property (queries.ts:70), and the mobile hook `useOwnerStatementDraft` (jna-cleaners-app `hooks/owner/index.ts:228`) already branches on missing `totals` → **no mobile changes**.

- [ ] **Step 1: Replace the query handler** in `convex/owner/queries.ts` — replace the whole existing export (lines 264-278):

Current code being replaced:
```ts
/** Draft (live, unfrozen) statement for the requested month. */
export const getOwnerStatementDraft = query({
  args: {
    propertyId: v.id("properties"),
    month: v.optional(v.string()), // YYYY-MM; defaults to current
  },
  handler: async (ctx, args) => {
    await assertOwnerOfProperty(ctx, args.propertyId);
    const month = args.month ?? currentMonthKey();
    const { start, end } = monthRange(month);
    const inputs = await loadEngineInputs(ctx, args.propertyId, start, end);
    const output = computeStatementForPeriod(inputs);
    return { month, periodStart: start, periodEnd: end, draft: output };
  },
});
```

New code:
```ts
/** Draft (live, unfrozen) statement for the requested month. */
export const getOwnerStatementDraft = query({
  args: {
    propertyId: v.id("properties"),
    month: v.optional(v.string()), // YYYY-MM; defaults to current
  },
  handler: async (ctx, args) => {
    await assertOwnerOfProperty(ctx, args.propertyId);
    const month = args.month ?? currentMonthKey();
    const { start, end } = monthRange(month);
    // Engine failures (e.g. no propertyFeeConfig active in this period —
    // a just-onboarded owner viewing a pre-onboarding month) must not
    // crash the whole property page. Return the same `{ error }` envelope
    // getOwnerDashboard uses per property; the mobile hook already
    // branches on it, and the web client guards with `"totals" in`.
    let draft: FeeEngineOutput | { error: string };
    try {
      const inputs = await loadEngineInputs(ctx, args.propertyId, start, end);
      draft = computeStatementForPeriod(inputs);
    } catch (e) {
      draft = { error: e instanceof Error ? e.message : String(e) };
    }
    return { month, periodStart: start, periodEnd: end, draft };
  },
});
```

- [ ] **Step 2: Typecheck — expect the web client to now FAIL** (this is the "failing test" proving the guard is needed)

Run: `npx tsc --noEmit`
Expected: errors in `src/components/owner/owner-property-client.tsx` at the `draft.draft.totals.*` accesses (property `totals` does not exist on `{ error: string }`). If it passes clean, stop and investigate — the union didn't propagate.

- [ ] **Step 3: Guard the web client.** In `src/components/owner/owner-property-client.tsx`, replace the block (currently lines 234-248):

Current code being replaced:
```tsx
      {draft && (
        <OverviewSummaryCard
          propertyId={propertyId}
          currency={currency}
          month={month}
          grossRevenue={draft.draft.totals.grossRevenue}
          stakePct={prop.ownership.stakePct}
          mortgageAmount={
            leaseRawMonthly > 0
              ? leaseRawMonthly
              : draft.draft.totals.costsByBucket.find((b) => b.bucket === "lease")
                  ?.amount ?? 0
          }
        />
      )}
```

New code (same `"totals" in` narrowing the dashboard uses, e.g. [owner-dashboard-client.tsx:699](../src/components/owner/owner-dashboard-client.tsx)):
```tsx
      {draft && "totals" in draft.draft && (
        <OverviewSummaryCard
          propertyId={propertyId}
          currency={currency}
          month={month}
          grossRevenue={draft.draft.totals.grossRevenue}
          stakePct={prop.ownership.stakePct}
          mortgageAmount={
            leaseRawMonthly > 0
              ? leaseRawMonthly
              : draft.draft.totals.costsByBucket.find((b) => b.bucket === "lease")
                  ?.amount ?? 0
          }
        />
      )}
      {draft && "error" in draft.draft && (
        <Card>
          <div className="px-4 py-3 text-sm text-[var(--cleaner-muted,#6b7280)]">
            No statement data for {fmtMonth(draft.month)} yet — this
            property&apos;s fee configuration doesn&apos;t cover that period.
            If you expected numbers here, contact Chez Soi Stays.
          </div>
        </Card>
      )}
```
Notes for the implementer: `Card` and `fmtMonth` are already in scope in this file (Card is used directly above this block; `fmtMonth` is imported at line 22). If the CSS variable `--cleaner-muted` doesn't exist in `src/app/cleaner.css`/owner styles, use the literal fallback form shown (`text-[var(--cleaner-muted,#6b7280)]`) — do NOT use `text-muted-foreground` (no-op in this repo).

- [ ] **Step 4: Verify types + lint pass**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean. Also run `node --test tests/` — all pass.

- [ ] **Step 5: Commit**

```bash
git add convex/owner/queries.ts src/components/owner/owner-property-client.tsx
git commit -m "fix(owner): statement draft returns error envelope instead of crashing page"
```

---

### Task 3: Onboarding default — first-ever config/owner rows backdate to first activity

**Files:**
- Create: `convex/lib/effectiveFrom.ts`
- Modify: `convex/owner/mutations.ts` (`upsertPropertyFeeConfig` ~line 47-89, `upsertPropertyOwners` ~line 91-146)
- Test: `tests/effective-from.test.mjs`

**Interfaces:**
- Produces: `firstEffectiveFromMs(earliestCheckInMs: number | null, now: number): number` — UTC month-start of the earliest stay, or `now` when the property has no stays. Used by both upsert mutations ONLY when the property has zero prior rows of that table.

- [ ] **Step 1: Write the failing test.** Create `tests/effective-from.test.mjs`:

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/effective-from.test.mjs`
Expected: FAIL — `Cannot find module '../convex/lib/effectiveFrom.ts'`

- [ ] **Step 3: Implement the pure helper.** Create `convex/lib/effectiveFrom.ts`:

```ts
/**
 * Default `effectiveFrom` for the FIRST-EVER propertyFeeConfig /
 * propertyOwners row on a property: the UTC month-start of the earliest
 * non-cancelled stay, so live drafts + statements work for the months the
 * property already has history in (fee engine requires a config active at
 * periodStart — see pickFeeConfigForPeriod). Subsequent (append-only,
 * time-versioned) upserts must keep `effectiveFrom = now`; callers only
 * invoke this when no prior row exists.
 *
 * `earliestCheckInMs === null` means "property has no stays yet" → `now`.
 */
export function firstEffectiveFromMs(
  earliestCheckInMs: number | null,
  now: number,
): number {
  if (earliestCheckInMs === null) return now;
  const d = new Date(earliestCheckInMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/effective-from.test.mjs`
Expected: 3 passing.

- [ ] **Step 5: Wire into `upsertPropertyFeeConfig`.** In `convex/owner/mutations.ts`, add to the imports near the top (`./` paths already exist for auth etc.):

```ts
import { firstEffectiveFromMs } from "../lib/effectiveFrom";
```

Add this small ctx-bound helper right above `upsertPropertyFeeConfig` (uses `QueryCtx`-compatible `MutationCtx` — extend the existing `_generated/server` import with `type MutationCtx` if not present):

```ts
/** Earliest non-cancelled check-in on the property, or null if no stays. */
async function earliestCheckInMs(
  ctx: MutationCtx,
  propertyId: Id<"properties">,
): Promise<number | null> {
  const stays = await ctx.db
    .query("stays")
    .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
    .collect();
  const earliest = stays
    .filter((s) => s.cancelledAt === undefined)
    .reduce((min, s) => Math.min(min, s.checkInAt), Infinity);
  return Number.isFinite(earliest) ? earliest : null;
}
```

Then in `upsertPropertyFeeConfig`'s handler, the existing code collects prior rows into `open` and inserts with `effectiveFrom: now`. Change the insert to use a computed value — first-ever rows backdate, updates keep `now`:

```ts
    // First-ever config on this property → backdate to first activity so
    // pre-onboarding months compute (see Docs/2026-07-04-fix-owner-statement-draft-crash.md).
    // Any later config change keeps append-only effectiveFrom=now.
    const effectiveFrom =
      open.length === 0
        ? firstEffectiveFromMs(await earliestCheckInMs(ctx, args.propertyId), now)
        : now;
```
and in the `ctx.db.insert("propertyFeeConfig", {...})` object change `effectiveFrom: now,` → `effectiveFrom,`.

- [ ] **Step 6: Wire into `upsertPropertyOwners`** the same way. Its handler collects prior rows into `existing`. Before the insert loop add:

```ts
    // Mirror upsertPropertyFeeConfig: first-ever ownership rows backdate to
    // first activity so pickOwnersForPeriod finds them in historical months.
    const effectiveFrom =
      existing.length === 0
        ? firstEffectiveFromMs(await earliestCheckInMs(ctx, args.propertyId), now)
        : now;
```
and in the `ctx.db.insert("propertyOwners", {...})` object change `effectiveFrom: now,` → `effectiveFrom,`.

- [ ] **Step 7: Full check**

Run: `npx tsc --noEmit && npm run lint && node --test tests/`
Expected: all clean/passing.

- [ ] **Step 8: Commit**

```bash
git add convex/lib/effectiveFrom.ts convex/owner/mutations.ts tests/effective-from.test.mjs
git commit -m "fix(owner): first-ever fee-config/owner rows backdate to first activity month"
```

---

### Task 4: PR + harness handoff (worktree session finishes here)

**Files:**
- Create: `.harness/handoffs/TASK-OWNER-DRAFT-ERROR-001/worktree-handoff.md`
- Modify: `.harness/integration-queue.md` (append entry)

- [ ] **Step 1: Rebase + push + open PR**

```bash
cd ~/sites/opscentral-admin-owner-draft-fix
git fetch origin && git rebase origin/main
npx tsc --noEmit && npm run lint && node --test tests/   # re-verify post-rebase
git push -u origin task/owner-draft-engine-error
gh pr create --title "fix(owner): graceful engine-error envelope + backdated first fee config" --body "$(cat <<'EOF'
## Summary
- getOwnerStatementDraft no longer crashes the owner property page when the fee engine can't compute a month (e.g. no propertyFeeConfig active in the period) — returns the same `{ error }` envelope getOwnerDashboard uses; web client renders a friendly notice (mobile already handled it)
- First-ever propertyFeeConfig/propertyOwners rows on a property now default effectiveFrom to the property's first-activity month instead of onboarding click-time, so newly onboarded owners can view historical months (root cause of the 2026-07-04 Tataw "Server Error")
- Pins pickFeeConfigForPeriod active-window contract + new pure helper under node --test

Root-cause analysis + prod data-repair record: Docs/2026-07-04-fix-owner-statement-draft-crash.md

## Test plan
- [ ] node --test tests/ green
- [ ] tsc + lint green
- [ ] After merge+deploy: owner property page for a month with no active fee config renders notice card, not error boundary

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Write the handoff file** `.harness/handoffs/TASK-OWNER-DRAFT-ERROR-001/worktree-handoff.md` (follow the template in `.harness/project-rules.md` "Handoff protocol"): task ID `TASK-OWNER-DRAFT-ERROR-001`, branch `task/owner-draft-engine-error`, PR URL from Step 1, schema impact **none**, Convex deploy required **yes** (query/mutation code changed), cleaners-app mirror required **yes** (`npm run sync:convex-backend` — no mobile UI changes needed, hook already guards).

- [ ] **Step 3: Append to `.harness/integration-queue.md`** with status Ready, then commit both harness files on the branch and push.

```bash
git add .harness/handoffs/TASK-OWNER-DRAFT-ERROR-001/ .harness/integration-queue.md
git commit -m "chore(harness): handoff TASK-OWNER-DRAFT-ERROR-001"
git push
```

---

### Task 5: Integration (MAIN SESSION ONLY — merge, deploy, mirror)

- [ ] **Step 1:** Merge the PR (main session reviews first; squash-merge per repo habit).
- [ ] **Step 2:** Deploy Convex from the main checkout:

```bash
cd /Users/atem/sites/jnabusiness_solutions/apps-ja/opscentral-admin
git pull
export $(grep -v '^#' .env.local | grep PROD_CONVEX_DEPLOY_KEY | xargs)
CONVEX_DEPLOY_KEY="$PROD_CONVEX_DEPLOY_KEY" npx convex deploy
```
(Node 20+; `nvm use lts/jod` if needed.)

- [ ] **Step 3:** Mirror backend to cleaners app:

```bash
cd /Users/atem/sites/jnabusiness_solutions/apps-ja/jna-cleaners-app
npm run sync:convex-backend
```
Commit the mirror per that repo's convention.

- [ ] **Step 4: End-to-end verify** — as Tataw (or via an owner test account): property page loads for `?month=2026-06` (real numbers, post-Task-0 backdate) AND for a month before the property's first stay (notice card, no crash). Write `.harness/handoffs/TASK-OWNER-DRAFT-ERROR-001/integration-result.md`, mark queue entry Done, remove worktree:

```bash
git worktree remove ~/sites/opscentral-admin-owner-draft-fix
git branch -D task/owner-draft-engine-error
```

---

## Self-review notes

- **Coverage:** symptom (crash) → Task 2; today's broken data → Task 0; recurrence (onboarding default) → Task 3; engine contract pinned → Task 1; repo protocol → Tasks 4-5.
- **Type consistency:** `draft: FeeEngineOutput | { error: string }` matches `getOwnerDashboard`'s per-property union (queries.ts:70); web guard `"totals" in` matches owner-dashboard-client.tsx usage; `firstEffectiveFromMs(earliestCheckInMs, now)` name/signature used identically in Tasks 3 Steps 1/3/5/6.
- **Known non-goals:** Tataw's Team-page/Owner-Overview drift (separate plan: `2026-07-04-owner-consistency-plan.md`); no admin UI date-picker for effectiveFrom (YAGNI — the first-activity default covers the real workflow).
