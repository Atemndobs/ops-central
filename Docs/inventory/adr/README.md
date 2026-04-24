# Inventory ADRs

Architectural Decision Records for the property-inventory system in OpsCentral.

Scope: how we store inventory, how it gets imported, how cleaners report shortages, and how admins act on shortages.

| #   | Title                                                                          | Status   |
| --- | ------------------------------------------------------------------------------ | -------- |
| 001 | [Standard CSV/XLSX importer in admin](0001-standard-inventory-importer.md)     | Accepted |
| 002 | [Canonical field schema + column mapping](0002-canonical-fields-and-mapping.md)| Accepted |
| 003 | [Saved import templates](0003-saved-import-templates.md)                       | Accepted |
| 004 | [Smart defaults on commit](0004-smart-defaults-on-commit.md)                   | Accepted |
| 005 | [Merge-by-name on re-import](0005-merge-by-name-on-reimport.md)                | Proposed |
| 006 | [Owner-facing blank template](0006-owner-facing-blank-template.md)             | Accepted |
| 007 | [Cleaner shortage reporting flow](0007-cleaner-shortage-reporting.md)          | Accepted |

## Context

- Convex already defines the backing tables (`inventoryCategories`, `inventoryItems`, `stockChecks`, `jobRefillChecks`, `refillQueue`) — see [`convex/schema.ts`](../../../convex/schema.ts) lines 810–960.
- An admin page at [`src/app/(dashboard)/inventory/page.tsx`](../../../src/app/(dashboard)/inventory/page.tsx) lists items + the refill queue.
- Source data lives in per-property CSVs like `FurnitureList–Dallas, 2BR, The Andaluz - The-Andaluz-SHOPPING.csv`.

## Format

Each ADR follows: Context → Decision → Alternatives considered → Consequences.
