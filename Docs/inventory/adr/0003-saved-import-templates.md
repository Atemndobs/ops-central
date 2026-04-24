# ADR-003: Saved import templates

**Status:** Accepted
**Date:** 2026-04-22

## Context

`ßThe same source (e.g. Randalls' shopping sheets, or a specific vendor's format) will be re-imported many times. Re-mapping columns every import is wasted clicks and a source of inconsistency.

## Decision

Persist column mappings as **import templates**.

New Convex table:

```ts
		inventoryImportTemplates: defineTable({
  name: v.string(),                  // "J&A Standard", "Randalls Shopping Sheet"
  description: v.optional(v.string()),
  mapping: v.object({                // canonical field -> source column header
    name: v.string(),
    category: v.optional(v.string()),
    room: v.optional(v.string()),
    locationDetail: v.optional(v.string()),
    quantityPurchased: v.string(),
    vendor: v.optional(v.string()),
    url: v.optional(v.string()),
    unitPrice: v.optional(v.string()),
    orderStatus: v.optional(v.string()),
    notes: v.optional(v.string()),
  }),
  defaults: v.optional(v.object({
    isRefillTrackedByCategory: v.optional(v.any()),
    minimumQuantityPctByCategory: v.optional(v.any()),
  })),
  createdBy: v.id("users"),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
}).index("by_name", ["name"])
```

Flow:

- Import modal shows a "Template" dropdown (with "None" default).
- After a successful mapping, offer **"Save as template"**.
- Templates are global (not per-property) — same vendor serves many properties.

## Alternatives considered

- **No persistence — remap every time.** Rejected: high friction for recurring sources.
- **Per-property templates.** Rejected: templates are about *source format*, not *destination property*.

## Consequences

- (+) First import from a new source is 30s of mapping; every subsequent import is zero-click on mapping.
- (+) Templates document known vendor formats.
- (−) One more table to maintain; must handle template deletion when source schema changes.
