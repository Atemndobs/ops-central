# ADR-001: Standard CSV/XLSX importer in admin

**Status:** Accepted
**Date:** 2026-04-22

## Context

Property inventory arrives as spreadsheets from owners, vendors, and Randalls. Today, there is no structured path from those sheets to Convex — items would have to be entered one-by-one via UI or a one-off script per property.

We expect this pattern to repeat for every new property onboarding (target: dozens per year).

## Decision

Build a **reusable import flow in the admin app**, surfaced on each property detail page as an "Import Inventory" action. Flow:

1. **Upload** — CSV (v1). XLSX deferred to v2.
2. **Map columns** — user maps source headers to our canonical fields; obvious matches auto-resolve.
3. **Preview** — validated table with per-row errors/warnings, skip toggles, category-creation prompts.
4. **Commit** — one Convex action writes items, upserts categories, returns `{ imported, skipped, errors }`.

The importer is the **only supported path** to create inventory in bulk. Manual add-one-item UI stays for corrections.

## Alternatives considered

- **Require owners to submit our canonical CSV format.** Rejected: owners won't rename their columns; too much friction for onboarding velocity.
- **Build a one-off script per property.** Rejected: non-reusable, engineer-time cost per property.
- **Use an external ETL tool.** Rejected: adds a dependency and an auth surface for non-technical ops staff.

## Consequences

- (+) Onboarding a new property's inventory is a 5-minute admin task, not an engineering task.
- (+) Vendors/owners can submit sheets in their native format.
- (−) Must maintain the mapping UI and parsing logic.
- (−) XLSX support deferred — owners must "File → Export CSV" for v1. Acceptable given Google Sheets / Excel both do this trivially.
