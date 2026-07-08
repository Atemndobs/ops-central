# Admin Owner Overview — Plan

**Date:** 2026-05-25
**Branch:** `feat/admin-owner-overview`
**Worktree:** `/Users/atem/sites/opscentral-admin-owner-overview`
**Status:** Draft — design agreed, ready to break into phases

---

## Problem

1. Admin has no way to see what a property owner sees on their portal. Owner-visibility flags in Settings are global toggles with no preview, and no awareness of what data exists vs what is shown.
2. The owner statements list is always empty — there is no UI to materialize a statement from the underlying bookings/costs, even though Wave 3a–3c already shipped the storage, PDF, and notification pieces.

This plan introduces a single admin surface — **Owner Overview** — that solves both: side-by-side preview of the owner's view + per-statement editor that materializes drafts and issues them through the existing pipeline.

## Goals

- Admin can see, for any owner + property + month, exactly what the owner sees and what is hidden.
- Admin can prepare, draft, and issue an owner statement from one page.
- Existing global visibility flags become defaults; per-statement overrides are stored on the statement row so historic statements are reproducible.
- Reuse existing owner components for the preview — no parallel design system.
- Reuse existing `ownerStatements` table, PDF generator (Wave 3b), and notifier (Wave 3c).

## Non-goals

- No new statement engine or PDF format.
- No changes to the cleaner / mobile app.
- No new Convex auth provider — admins read via existing admin-scope queries.
- Owner-side UI changes — only additive overrides on the data feed.

---

## Information architecture

Top-level admin nav adds **Owner Overview** between Team and Reports.

```
/admin/owner-overview
  → list of owners (one row per owner, grouped)
    columns: Owner · # properties · Last statement (period, status) · Next due · Drafts pending

/admin/owner-overview/[ownerId]
  → per-owner dashboard, mirrors /owner
    sections: Summary across properties · Statements list (all periods, all properties) · Properties grid

/admin/owner-overview/[ownerId]/properties/[propertyId]
  → per-property detail with period picker
    layout: split view (owner preview LEFT, admin editor RIGHT)

/admin/owner-overview/[ownerId]/properties/[propertyId]/statements/[period]
  → deep-link to a specific statement in the split view (same component, period locked)
```

URL shape mirrors `/owner/*` 1:1 with the `admin/owner-overview` prefix.

## Page design — property detail (the meat)

Single page, three regions: header + two columns.

### Header
- Breadcrumb: Owner › Property › Period
- Period stepper: `< May 2026 >` (calendar month, default = current month)
- `Open as owner would see ↗` — link that opens `/owner/properties/[id]?month=YYYY-MM&preview=admin` in a new tab, server-allowed for admins
- Status pill: `DRAFT` / `READY` / `ISSUED` / `SENT`
- Primary CTA: `Issue statement →` (disabled until READY)

### Left column — Owner preview (read-only)
- Renders the same components used at `/owner/properties/[id]` (`PropertyHeader`, `SummaryCard`, `BookingsList`, `CostsList`, `MortgageCoverageBar`, `StatementWaterfall`).
- Fed by a new query `getAdminOwnerPreview({ ownerId, propertyId, period, overrides })` that returns the same shape as the owner query, applying per-statement overrides on top of global flags.
- Hidden line items are *not* shown in this column — it is what the owner would see if you issued this draft right now.

### Right column — Admin editor (editable)
1. **Visibility overrides** — per-statement checkboxes for `mortgage`, `mgmt_fee`, `payout`, `cost_line_items`. Each toggle shows the global default with a `(default)` label until the admin overrides it (then `(override)`).
2. **Bookings table** — every booking in the period, with `Include in statement` checkbox per row. Excluded rows are excluded from gross.
3. **Costs table** — every cost in the period, with `Include` checkbox and an inline bucket dropdown (admin can recategorize before issuing).
4. **Notes to owner** — markdown textarea, rendered into the PDF and into a notes section above the statement waterfall on the owner page.
5. **Status panel** — current status, audit trail (created, edited by, issued by, sent at), and action buttons:
   - `Save draft`
   - `Mark ready`
   - `Issue statement` (triggers existing `issueOwnerStatement` mutation → PDF schedule + notifier)
   - `Recall / re-issue` (only if SENT, opens confirmation modal)

### Empty / edge states
- No bookings in period: left column shows "No activity this month"; right column is collapsed; `Issue` is disabled.
- Owner has multiple properties: list at `/admin/owner-overview/[ownerId]` is the entry point; period picker lives at property level.
- Mid-month preview: header shows "Period in progress — preview only" until the period closes.

---

## Data model

Existing `ownerStatements` row gets these fields (additive, default to null/empty so old rows still render):

```ts
overrides: v.optional(v.object({
  show_mortgage: v.optional(v.boolean()),
  show_mgmt_fee: v.optional(v.boolean()),
  show_payout: v.optional(v.boolean()),
  show_cost_line_items: v.optional(v.boolean()),
})),
excludedBookingIds: v.optional(v.array(v.id("bookings"))),
excludedCostIds: v.optional(v.array(v.id("costs"))),
costBucketOverrides: v.optional(v.array(v.object({
  costId: v.id("costs"),
  bucket: v.string(),
}))),
notes: v.optional(v.string()),
status: v.union(
  v.literal("draft"),
  v.literal("ready"),
  v.literal("issued"),
  v.literal("sent"),
  v.literal("recalled"),
),
auditTrail: v.array(v.object({
  at: v.number(),
  actorUserId: v.id("users"),
  action: v.string(),
})),
```

No new tables. Schema change goes through the standard schema-first flow in `.harness/convex.md`.

## Convex API surface

New queries (admin-only, role-checked via existing admin guards):

- `admin.ownerOverview.listOwners()` → list owners + summary counters for the index page
- `admin.ownerOverview.getOwnerDashboard({ ownerId })` → cross-property summary
- `admin.ownerOverview.getPropertyPreview({ ownerId, propertyId, period })` → returns BOTH the owner-shaped preview data (after applying overrides) AND the raw editor data (all bookings/costs incl. excluded, current overrides, status, audit trail) in one payload
- `admin.ownerOverview.listStatements({ ownerId })` → cross-property statements list

New mutations:

- `admin.ownerOverview.upsertDraft({ ownerId, propertyId, period, patch })` → idempotent; creates row on first call, updates on subsequent calls
- `admin.ownerOverview.markReady({ statementId })`
- `admin.ownerOverview.issueStatement({ statementId })` → wraps existing `issueOwnerStatement`, writes audit, schedules PDF + notifier
- `admin.ownerOverview.recallStatement({ statementId, reason })`

Auto-create cron (default OFF behind a feature flag, mirroring Wave 3b auto-approve):

- `admin.ownerOverview.crons.autoCreateMonthlyDrafts` — on the 1st of each month, walk every active (ownerId, propertyId) pair and upsert a DRAFT statement for the previous month if one does not exist. Pre-populates `excludedBookingIds: []`, `excludedCostIds: []`, no overrides. Admins still have to issue.

## Component reuse

| Component | Lives in | Used by owner | Used by admin |
| --- | --- | --- | --- |
| `SummaryCard` | `src/components/owner/SummaryCard.tsx` | yes | yes (LEFT) |
| `StatementWaterfall` | `src/components/owner/StatementWaterfall.tsx` | yes | yes (LEFT) |
| `BookingsList` | `src/components/owner/BookingsList.tsx` | yes | yes (LEFT) |
| `CostsList` | `src/components/owner/CostsList.tsx` | yes | yes (LEFT) |
| `MortgageCoverageBar` | `src/components/owner/MortgageCoverageBar.tsx` | yes | yes (LEFT) |
| `BookingsEditor` | NEW `src/components/admin/owner-overview/BookingsEditor.tsx` | — | yes (RIGHT) |
| `CostsEditor` | NEW | — | yes (RIGHT) |
| `VisibilityOverridePanel` | NEW | — | yes (RIGHT) |
| `StatementStatusPanel` | NEW | — | yes (RIGHT) |

Owner components are not modified — they consume the same data shape, but the data is now produced by the admin preview query (after applying overrides) instead of the owner query.

---

## Rollout phases

1. **Phase 1 — Schema + queries (backend only, behind admin role gate)**
   - Schema migration (additive fields on `ownerStatements`)
   - `getPropertyPreview` + `listOwners` + `getOwnerDashboard` queries
   - `upsertDraft` mutation (no UI yet — verify via Convex dashboard)
   - Unit-level verification: existing owner statements still render unchanged

2. **Phase 2 — Index + owner dashboard pages**
   - `/admin/owner-overview` list
   - `/admin/owner-overview/[ownerId]` dashboard
   - Nav item in sidebar
   - No editor yet — just read-only mirrors

3. **Phase 3 — Property split view (read-only preview)**
   - `/admin/owner-overview/[ownerId]/properties/[propertyId]`
   - LEFT column renders owner components against admin preview query
   - RIGHT column is read-only: shows what would-be-hidden data exists, no edit controls yet

4. **Phase 4 — Editor (the statement builder)**
   - `BookingsEditor`, `CostsEditor`, `VisibilityOverridePanel`, `StatementStatusPanel`
   - `upsertDraft` + `markReady` + `issueStatement` wired
   - `notes` markdown textarea
   - Audit trail
   - This is the phase that fixes "the statement is always empty"

5. **Phase 5 — Auto-create cron + recall flow**
   - `autoCreateMonthlyDrafts` (default OFF flag)
   - `recallStatement` + re-issue path
   - `Open as owner would see ↗` admin-impersonation deep link

Each phase is its own PR, merged in order. Phases 1–4 are blocking; Phase 5 can ship later.

## Risks and tradeoffs

- **Data drift between owner query and preview query.** The owner page already has a working query — if the admin preview query reimplements it, the two can drift. *Mitigation:* extract the shared shaping logic into a single `composeOwnerStatementView(...)` function used by both queries; overrides are applied on top in the admin variant.
- **Per-statement overrides could surprise admins.** Toggling a global default in Settings would *not* affect already-issued statements. *Mitigation:* the override panel always shows global default vs override side by side; status panel surfaces "uses 2 overrides for this statement".
- **Auto-create cron could spam drafts.** Default OFF, opt-in per-owner via Settings.
- **Split view on a phone.** The editor is admin-only; we lock the layout at `lg` breakpoint and below, stack columns vertically (preview first, editor below).

## Open questions

- Should the owner be notified when a DRAFT exists but is not yet issued? (Default answer: no — drafts are invisible to owner.)
- Should `recall` keep the PDF available with a "recalled" watermark, or hard-delete it from storage? (Default answer: keep with watermark, immutable history.)
- Where does the existing Settings → OwnerVisibilityFlags page live in this story? (Default answer: it stays as the global default editor; we add a "View what owner sees →" link from there to `/admin/owner-overview`.)

---

## Next step

Phase 1 is the schema change. Per `.harness/convex.md`, we do schema-first and verify both apps still build before touching UI. Once you sign off on this plan, the next action is a schema PR on this branch.
