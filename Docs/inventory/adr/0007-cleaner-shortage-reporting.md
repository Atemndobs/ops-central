# ADR-007: Cleaner shortage reporting flow

**Status:** Accepted (backend already exists; documenting intent)
**Date:** 2026-04-22

## Context

The point of importing inventory is to make shortage reporting structured: cleaners should tell admins *which* item is low/empty in *which* room of *which* property, not post a freeform photo to WhatsApp. Convex already has the tables — this ADR documents the flow we'll target.

## Decision

### Data flow

```
cleaner opens job
    │
    ▼
jobRefillChecks (one row per refill-tracked item per job revision)
    │ percentRemaining + level ∈ {ok, low, critical, out}
    ▼
on level ≠ ok  →  upsert refillQueue row for (property, item)
    │
    ▼
admin UI (inventory page → refill queue tab)
    open → acknowledged → ordered → resolved
```

### Cleaner app surfaces

- The cleaner job checklist exposes refill-tracked items (`isRefillTracked: true`), grouped by room, ordered by `refillDisplayOrder`.
- Each item renders a quick picker: **Full / Low / Critical / Empty** + optional photo + optional note.
- Defaults: percent estimates derived from level (full=100, low=30, critical=10, out=0) unless cleaner provides a specific number.
- Items not marked are assumed `ok` (no write).

### Admin surfaces

- The refill queue tab in `/inventory` already exists and lists `open` shortages per property.
- Per-row actions: **Acknowledge** (seen, not yet ordered) → **Mark ordered** (with optional tracking link) → **Resolve** (when restocked).
- Resolving a queue row flips the `inventoryItems.status` back to `"ok"` and sets `quantityCurrent = quantityPurchased`.

### Triggers downstream

- Level `critical` or `out` → push notification to property_ops role (uses existing `notifications` infra).
- Level `low` → batched daily digest, no per-event push.

## Alternatives considered

- **Cleaner reports shortages via messages/WhatsApp.** Rejected: unstructured, no link to specific item/property/job.
- **Per-item checkbox "need more" without levels.** Rejected: loses urgency signal (low vs out differ by days-until-stockout).

## Consequences

- (+) Every shortage is tied to a specific `(property, item, job)` — actionable.
- (+) Admins see an aggregated queue, not N messages.
- (−) Cleaners must tap through refill-tracked items each job. Keep the UI fast (one-tap default + swipe).
- (−) Estimates can drift if cleaners over/underreport. Track calibration via `stockChecks.quantityBefore/After` during restocks.

## Related

- Backend tables: [`convex/schema.ts:911-960`](../../../convex/schema.ts)
- Refill queries/mutations: [`convex/refills/`](../../../convex/refills)
- Admin UI: [`src/app/(dashboard)/inventory/page.tsx`](../../../src/app/(dashboard)/inventory/page.tsx)
