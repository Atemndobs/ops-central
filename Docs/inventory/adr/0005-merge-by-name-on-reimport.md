# ADR-005: Merge-by-name on re-import

**Status:** Proposed (awaiting confirmation)
**Date:** 2026-04-22

## Context

Owners/vendors will re-submit updated sheets — new items added, prices changed, quantities refreshed after a big reorder. If we always append, we'll get duplicates; if we always replace, we'll lose operational state (`quantityCurrent`, refill history, linked checkpoints).

## Decision (proposed)

Default strategy: **merge by `(propertyId, name)` case-insensitive**.

- **Existing item matched by name:** update `quantityPurchased`, `metadata` (vendor/url/price/orderStatus), `room`, `category`. Do **not** touch `quantityCurrent`, `minimumQuantity`, `status`, `isRefillTracked`, thresholds, or `lastCheckedAt`.
- **New item (no match):** insert with ADR-004 defaults.
- **Existing item not present in import:** leave untouched (do NOT archive automatically).

The import preview shows the effect per row: **New / Update / Unchanged**, with a toggle on each row. A top-level choice also exposes **"Replace all"** (delete then insert) and **"Append only"** (skip matches), for edge cases.

## Alternatives considered

- **Always append.** Rejected: creates silent duplicates.
- **Always replace.** Rejected: destroys operational state and breaks references (stock checks, refill queue).
- **Match by a separate stable ID (e.g. SKU).** Rejected for v1: owners' sheets don't reliably have SKUs; revisit if needed.

## Consequences

- (+) Re-imports are safe and idempotent for the common case.
- (−) Name changes in the source sheet create new items instead of updating — user must resolve manually in the preview.
- (−) Fuzzy-matching (e.g. "Queen Comforter" vs "Queen Comforter (king-size)") is out of scope; relies on exact-ish names.

## Open question

Confirm with ops: should "Existing item not present in import" auto-archive, stay, or flag as "needs review"? Current proposal: leave untouched.
