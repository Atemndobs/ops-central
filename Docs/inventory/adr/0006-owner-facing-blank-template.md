# ADR-006: Owner-facing blank template

**Status:** Accepted
**Date:** 2026-04-22

## Context

Onboarding is faster when owners submit data in our canonical format — no mapping step needed. But we don't want to *require* it (see ADR-002: mapping handles arbitrary formats).

## Decision

Provide a **"Download blank template"** button in the importer modal. It downloads a CSV with:

- Canonical headers (`name`, `category`, `room`, `location_detail`, `quantity_purchased`, `vendor`, `url`, `unit_price`, `order_status`, `notes`).
- One example row filled in (e.g. `"Toilet paper (30 rolls)", "Consumables", "All Bathrooms", "Bathroom - Storage", 1, "Amazon", "https://...", "20.00", "ordered", ""`).
- A second "instructions" row starting with `#` that the importer will skip (explains each column in plain English).

Shipped as a static asset, not generated — simpler, versionable.

Also provide a **Google Sheets link** to a shared template that owners can copy (File → Make a copy). Same content, easier for non-technical owners.

## Alternatives considered

- **PDF instructions.** Rejected: owners would need to retype everything; no value over CSV.
- **Web form for item-by-item entry.** Rejected: too slow for 100+ item lists.

## Consequences

- (+) Path of least resistance for owners who want zero friction.
- (+) Sets a known-good format as the implicit standard.
- (−) Two templates to maintain (CSV + Sheet) — must version them together.
