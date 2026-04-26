# Service Usage Monitoring — Real Quota Integration

**Status:** Spec / not yet implemented
**Created:** 2026-04-26
**Owner:** Bertrand
**Related:** [ai-ops-assistant/](../ai-ops-assistant/), `convex/serviceUsage/`

---

## Problem

The `/settings/usage` dashboard today shows self-instrumented numbers
only. The Convex card reports "$0.000 / 33 calls" while the real Convex
console shows we are at >90% of the monthly function-call quota and
about to be cut off.

Root cause: `convex/serviceUsage/convexSnapshot.ts` cannot read Convex's
own billing API from inside a Convex function. So the card just counts
the rows the snapshot itself wrote — a pure self-loop, not real usage.

The same gap exists for every other paid platform we depend on (Clerk,
Backblaze B2, Hospitable, Gemini, PostHog, Sentry, Resend, Vercel). We
have *no* admin-facing alert that says "you're at 90% on X — react now."

## Goal

Two complementary deliverables:

1. **Real-quota Service Usage page** — `/settings/usage` shows a
   coloured quota bar per service driven by data fetched from each
   provider's own usage/billing API (or scraped from the dashboard
   when no API exists). Bars turn yellow at 80%, red at 95%.
2. **Chatbot quota tool** — the existing AI ops assistant gets a new
   `getServiceUsage` tool so an admin can ask "how close are we to the
   Convex quota?" from any page and get a fresh number on demand.

The chatbot path goes **directly to the provider API** when invoked
(no Convex query layer), so we don't burn Convex function calls just
to ask Convex how many function calls we have left.

## Documentation Index

| Document | Purpose |
|----------|---------|
| [README.md](README.md) | This file — problem, goal, scope |
| [architecture.md](architecture.md) | Components, data flow, provider matrix |
| [implementation-plan.md](implementation-plan.md) | Phased build plan with acceptance criteria |
| [provider-apis.md](provider-apis.md) | Per-provider API endpoints, auth, response shape |

## Scope (v1)

**In scope:**
- New Convex action `serviceUsage.providerSync.fetchAll` running every
  60 min, writing real numbers into `serviceQuotaCounters`.
- Per-provider adapter modules under `convex/serviceUsage/providers/`
  (one file per provider, all stateless).
- UI: quota bar + percent + "X days into Y-day window" caption on
  every service card; banner alert when ≥1 service is at ≥90%.
- Summary tile on `/settings/usage` overview: "N services > 80% quota".
- Chatbot tool `getServiceUsage(serviceKey?)` — direct provider call,
  no DB roundtrip. Returns the same shape as the UI sees.
- Coverage at launch: **Convex, Clerk, Backblaze B2** (the three we
  pay for and have hit limits on).

**Out of scope (v1):**
- Auto-upgrading plans, paying invoices, or any write-side action.
- Per-feature attribution ("which page burned the calls"). The
  existing self-instrumentation already does this — we are not
  replacing it, only adding a real-quota overlay on top.
- Hospitable, Gemini, PostHog, Sentry, Resend, Vercel adapters —
  follow-on phase, same pattern.
- Email/SMS alerting on threshold crossings (next iteration; first
  surface the data, then route alerts).

## Non-Goals

- Replacing the existing `serviceUsageEvents` self-instrumentation.
  That stays — it's our per-feature attribution. This work *adds* a
  ground-truth quota layer on top of it.
- Building a generic "any-API observability" framework. Three concrete
  adapters, hand-written, cheaper than abstraction.

## Success Criteria

1. Open `/settings/usage` and see a Convex quota bar that matches the
   number on `dashboard.convex.dev` within ±5%.
2. Burn through Convex calls in a load test → bar turns red, banner
   shows, dashboard summary tile increments.
3. Ask the chatbot "how's our Convex quota?" from any page → get an
   answer derived from a *fresh* provider API call (verifiable in
   network tab, not from cached Convex rows).
4. Adding a new provider takes ≤1 file under `providers/` plus one
   registry entry — no schema changes, no UI changes.
