# ADR-002: Canonical field schema + column mapping

**Status:** Accepted
**Date:** 2026-04-22

## Context

Source sheets have varying column names ("Item Name" vs "Product", "Quantity" vs "Qty", "link" vs "URL"). We need a stable internal shape that maps to `inventoryItems` in Convex, plus a mechanism to map arbitrary source columns onto it.

## Decision

Define a **canonical row shape** used inside the importer, independent of source headers:

| Canonical field      | Required | Maps to `inventoryItems`          | Notes                                   |
| -------------------- | -------- | --------------------------------- | --------------------------------------- |
| `name`               | ✓        | `name`                            |                                         |
| `category`           |          | `categoryId` (upsert by name)     | Free text; auto-creates category        |
| `room`               |          | `room`                            | Free text; kept as-is                   |
| `locationDetail`     |          | `metadata.locationDetail`         | e.g. "Bathroom - Storage"               |
| `quantityPurchased`  | ✓        | `quantityPurchased`               | Coerced to number                       |
| `vendor`             |          | `metadata.vendor`                 |                                         |
| `url`                |          | `metadata.url`                    | Product link                            |
| `unitPrice`          |          | `metadata.unitPrice`              | Cents, parsed from "$20.00"             |
| `orderStatus`        |          | `metadata.orderStatus`            | Free text ("ordered", "from Skagen", …) |
| `notes`              |          | `metadata.notes`                  |                                         |

Validation rules:
- `name` trimmed, non-empty.
- `quantityPurchased` integer ≥ 0; rows with empty quantity default to `1` with a warning.
- `unitPrice` parsed from currency strings; non-numeric → null + warning.
- `category` case-normalized (Title Case), trimmed.

## Column mapping UI

- Auto-match on normalized header equality (lowercase, strip whitespace/punctuation).
- Levenshtein fuzzy-match as fallback for minor typos (`Qty` ↔ `Quantity`).
- User can remap any column manually.
- Unmapped source columns → ignored (not an error).
- Required canonical fields must have a mapping before "Preview" is enabled.

## Alternatives considered

- **Store raw CSV rows in `metadata` without a canonical shape.** Rejected: downstream code (refill queue, low-stock alerts) needs structured fields.
- **Make every source field a first-class column in `inventoryItems`.** Rejected: schema bloat; most fields are reference data, not operational.

## Consequences

- (+) One import pipeline supports any source sheet format.
- (+) Reference fields (vendor, url, price) preserved for re-ordering without polluting the hot schema.
- (−) `metadata` is `v.any()` — consumers must handle missing keys defensively.
