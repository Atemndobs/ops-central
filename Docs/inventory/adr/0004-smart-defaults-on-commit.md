# ADR-004: Smart defaults on commit

**Status:** Accepted
**Date:** 2026-04-22

## Context

Source sheets capture what was *purchased*, not operational state (`quantityCurrent`, `minimumQuantity`, `status`, `isRefillTracked`). Without defaults, every row would require manual editing post-import — defeating the purpose.

## Decision

On commit, the Convex action fills operational fields with these defaults:

| Field                        | Default                                                              | Rationale                                          |
| ---------------------------- | -------------------------------------------------------------------- | -------------------------------------------------- |
| `quantityCurrent`            | `quantityPurchased`                                                  | Fresh import = fully stocked                       |
| `minimumQuantity`            | `ceil(quantityPurchased * 0.2)`, min 1                               | Trigger low-stock at 20% remaining                 |
| `status`                     | `"ok"`                                                               |                                                    |
| `requiresRestock`            | `false`                                                              |                                                    |
| `isRefillTracked`            | `category === "Consumables"` → `true`; else `false`                  | Only consumables deplete between cleans            |
| `refillLowThresholdPct`      | `40` (consumables only)                                              | Cleaner flags "low" at 40% remaining               |
| `refillCriticalThresholdPct` | `15` (consumables only)                                              | Cleaner flags "critical" at 15% remaining          |
| `refillDisplayOrder`         | incrementing per (property, category) as rows are processed          | Preserves source-sheet order in the cleaner UI     |
| `createdAt`                  | `Date.now()`                                                         |                                                    |

All defaults are **overridable per import template** (ADR-003: `defaults` field) and editable per item after import.

Special case — **Furniture and Smallware:**
- Not refill-tracked (they don't deplete).
- `minimumQuantity = 0` if we never plan to restock (e.g. one-off furniture).
  - For v1, keep the 20% rule; ops can zero-out post-import on the few items where it matters.

## Alternatives considered

- **Require all operational fields in the CSV.** Rejected: owners/vendors won't fill them; breaks the onboarding promise.
- **No defaults — status `"ok"` only, everything else 0/null.** Rejected: leaves refill tracking unusable until someone edits every item.

## Consequences

- (+) Import produces an immediately-functional inventory.
- (+) Defaults are transparent and documented.
- (−) 20% threshold is a guess; we'll need to tune it from cleaner feedback after the first few cleaning cycles.
