# Maintenance Section — Implementation Plan

**Date:** 2026-04-28
**Owner:** Bertrand (CEO)
**Status:** Draft — awaiting partner review
**Related docs:**
- [2026-04-21-incident-management-plan.md](2026-04-21-incident-management-plan.md)
- [Cleaning_Execution_Contracts_and_Data_Model.md](Cleaning_Execution_Contracts_and_Data_Model.md)

---

## 1. Why a separate Maintenance section

Today everything anomalous found at a property — a missing towel, a damaged
chair, a leaking faucet, a guest complaint — funnels into the single
`incidents` table. That works for **reporting** (cleaners can capture issues
fast from the field) but it conflates two very different lifecycles:

| Concern              | Lifecycle                                                                 | Owner            |
| -------------------- | ------------------------------------------------------------------------- | ---------------- |
| **Incident**         | "Something happened on this job" — short, triaged in hours/days           | Cleaner → Ops    |
| **Maintenance work** | "A unit needs a repair" — scheduled, vendor-coordinated, may take weeks   | Ops → Vendor     |

Bundling them together means:
- Maintenance work that takes 3 weeks pollutes the incident queue.
- Vendor coordination, parts costs, and warranty info have nowhere to live.
- Recurring/preventive maintenance (HVAC service, deep clean, smoke detector
  battery swap) has no home at all — it isn't an "incident" by any normal
  definition.

**Decision:** Promote maintenance to a first-class section, peer to Incidents.
Incidents remain the **intake/reporting** surface; Maintenance is the
**work-tracking** surface (what was previously called "Work Orders" in
CLAUDE.md and the Breezeway pattern notes).

> Naming: we considered keeping the term "Work Orders." We picked
> **Maintenance** because (a) it's the language partners and vendors already
> use, (b) "work order" connotes a single ticket, while Maintenance also
> covers preventive/recurring work, and (c) it reads cleaner in the sidebar.

---

## 2. Conceptual model

```
                ┌──────────────────────┐
   Cleaner  ──▶ │       Incident       │  (intake — fast capture, photo, severity)
                │  type: maintenance_  │
                │        needed        │
                └──────────┬───────────┘
                           │ ops triages
                           │ "this is real work, not a one-off"
                           ▼
                ┌──────────────────────┐
                │   Maintenance Ticket │  (work tracking)
                │   • vendor           │
                │   • cost             │
                │   • scheduled date   │
                │   • status pipeline  │
                └──────────┬───────────┘
                           │
                           ├──▶ links back to originating incident
                           │     (incident closes when ticket closes,
                           │      or stays open if work is deferred)
                           │
                           └──▶ may exist with NO incident
                                 (preventive / recurring / ops-initiated)
```

Key rules:
1. **Incidents do not become maintenance tickets** — they *spawn* one. The
   incident remains as the historical reporting record.
2. **Maintenance tickets can exist without an incident** (preventive HVAC,
   pool service, ops-noticed wear).
3. **One incident → at most one maintenance ticket** (in v1). Splits/merges
   are out of scope.
4. **Closing the maintenance ticket** auto-resolves the linked incident
   (configurable; default on).

---

## 3. Data model (Convex)

New table: **`maintenanceTickets`**

```ts
maintenanceTickets: defineTable({
  // Identity
  title: v.string(),
  description: v.optional(v.string()),
  propertyId: v.id("properties"),

  // Origin
  sourceIncidentId: v.optional(v.id("incidents")),
  // null = ops-initiated / preventive
  createdBy: v.id("users"),

  // Classification
  category: v.union(
    v.literal("plumbing"),
    v.literal("electrical"),
    v.literal("hvac"),
    v.literal("appliance"),
    v.literal("furniture"),
    v.literal("structural"),
    v.literal("pest_control"),
    v.literal("landscaping"),
    v.literal("preventive"),
    v.literal("other"),
  ),
  priority: v.union(
    v.literal("low"),
    v.literal("medium"),
    v.literal("high"),
    v.literal("urgent"),
  ),

  // Workflow
  status: v.union(
    v.literal("triage"),             // just promoted from incident, not yet planned
    v.literal("approval_pending"),   // waiting on property-owner sign-off
    v.literal("scheduled"),          // vendor + date booked
    v.literal("in_progress"),        // vendor on site / parts in transit
    v.literal("blocked"),            // waiting on parts / access (NOT owner approval — that's its own state)
    v.literal("completed"),          // work done, awaiting verification
    v.literal("verified"),           // ops confirmed fix; ticket closed
    v.literal("cancelled"),
  ),
  requiresOwnerApproval: v.optional(v.boolean()),
  ownerApprovalDecidedAt: v.optional(v.number()),
  ownerApprovalDecidedBy: v.optional(v.id("users")),
  ownerApprovalNote: v.optional(v.string()),

  // Scheduling
  reportedAt: v.number(),
  scheduledFor: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  verifiedAt: v.optional(v.number()),

  // Vendor / cost
  vendorId: v.optional(v.id("vendors")),       // future table
  vendorContact: v.optional(v.string()),       // freeform until vendors table lands
  estimatedCostCents: v.optional(v.number()),
  actualCostCents: v.optional(v.number()),
  invoiceStorageId: v.optional(v.id("_storage")),

  // Photos (reuse canonical photo model)
  photoIds: v.optional(v.array(v.id("photos"))),

  // Recurrence (preventive maintenance)
  recurrence: v.optional(v.union(
    v.literal("monthly"),
    v.literal("quarterly"),
    v.literal("biannual"),
    v.literal("annual"),
  )),
  nextDueAt: v.optional(v.number()),

  // External sync (mirror incidents pattern)
  trelloCardId: v.optional(v.string()),
  trelloSyncedAt: v.optional(v.number()),
})
  .index("by_property", ["propertyId"])
  .index("by_status", ["status"])
  .index("by_property_and_status", ["propertyId", "status"])
  .index("by_source_incident", ["sourceIncidentId"])
  .index("by_next_due", ["nextDueAt"]),
```

**Schema additions on existing tables:**

- `incidents` — add `maintenanceTicketId: v.optional(v.id("maintenanceTickets"))`
  so incidents render a "View work" link when promoted.

**Future (out of v1):**
- `vendors` table — **promoted to Phase 4** (see §9.3)
- `maintenanceTicketLogs` table (audit of status transitions, comments)
- Cost-driven automation / owner-billing integration — **deferred to a
  separate property-owner billing flow** (see §9.2)

---

## 4. Backend functions

`convex/maintenance/`

- `queries.ts`
  - `listTickets({ status?, propertyId?, category?, priority?, limit })`
  - `getTicketById(id)` — joins property, originating incident, photos,
    vendor info, resolver
  - `getOpenCounts()` — KPI for dashboard (`triage`, `scheduled`,
    `in_progress`, `blocked`)
  - `listForProperty(propertyId)` — used by Property detail page tab
  - `listUpcomingPreventive({ daysAhead })` — surfaces `nextDueAt` window

- `mutations.ts`
  - `createTicket(...)` — ops-initiated; no incident required
  - `promoteFromIncident({ incidentId, ... })` — creates ticket, links
    `incidents.maintenanceTicketId`, transitions incident to `in_progress`
  - `updateStatus({ id, status, note? })` — single transition entry point;
    enforces allowed transitions (state machine in §6)
  - `scheduleWork({ id, scheduledFor, vendorContact })`
  - `recordCompletion({ id, actualCostCents, invoiceStorageId, photoIds })`
  - `verifyAndClose({ id, alsoCloseIncident: boolean })`
  - `cancelTicket({ id, reason })`
  - `setRecurrence({ id, recurrence, nextDueAt })`

- `actions.ts`
  - `syncToTrello(ticketId)` — mirror incidents Trello bridge; separate
    Maintenance board column scheme
  - `materializeNextOccurrence(ticketId)` — when a recurring ticket closes,
    schedule the next one

---

## 5. Admin UI (Next.js)

Routes under `src/app/(dashboard)/maintenance/`:

| Route                               | Purpose                                                  |
| ----------------------------------- | -------------------------------------------------------- |
| `/maintenance`                      | List + filters (status, property, category, priority)    |
| `/maintenance/[id]`                 | Ticket detail — timeline, photos, vendor, costs, actions |
| `/maintenance/new`                  | Manual ticket creation (preventive / ops-initiated)      |
| `/maintenance/calendar` *(later)*   | Scheduled work on a property × time grid                 |

**Cross-cutting placements:**
- **Sidebar** — new `Maintenance` item next to `Incidents` (✅ done in this commit; uses `Wrench` icon).
- **Property detail** — add a "Maintenance" tab showing tickets for that property.
- **Incident detail** — add a "Promote to Maintenance" button when type is
  `maintenance_needed` and no `maintenanceTicketId` exists yet.
- **Dashboard** — add an "Open maintenance" KPI card next to incidents.

Components reuse existing primitives: `DataTable`, `StatusPill`,
`PriorityBadge`, photo grid from canonical photo model. Follow shadcn/ui
conventions per [CLAUDE.md](../CLAUDE.md).

---

## 6. State machine

Allowed transitions (enforced in `updateStatus`):

```
triage            ──▶ approval_pending, scheduled, blocked, cancelled
approval_pending  ──▶ scheduled, cancelled
scheduled         ──▶ in_progress, blocked, cancelled
in_progress       ──▶ completed, blocked, cancelled
blocked           ──▶ scheduled, in_progress, cancelled
completed         ──▶ verified, in_progress (re-open if verification fails)
verified          ──▶ (terminal — only `recurrence` re-spawns a new ticket)
cancelled         ──▶ (terminal)
```

Rule: if `requiresOwnerApproval === true` at promotion time, the
mandatory next state from `triage` is `approval_pending` (the
`scheduled` shortcut is not selectable until approval is recorded).

Status colors (admin dark theme):
- triage = gray, approval_pending = purple, scheduled = blue,
  in_progress = amber, blocked = red, completed = green-muted,
  verified = green, cancelled = neutral

---

## 7. Mobile (cleaner) impact

Out of scope for v1 — cleaners continue to file `incidents` with
`incidentType: "maintenance_needed"`. They do NOT see maintenance tickets.

Future: a read-only "Known issues at this property" section in the cleaner
job-detail screen so cleaners aren't surprised by visible damage that's
already being worked on. Tracked separately.

---

## 8. Rollout phases

| Phase | Scope                                                                      | Estimate |
| ----- | -------------------------------------------------------------------------- | -------- |
| **0** | Sidebar nav item + stub page + this plan doc                               | ✅ done   |
| **1** | Schema + backend queries/mutations + state machine + tests                 | 2–3 days |
| **2** | Admin list + detail page (no vendor/cost yet — just status flow)           | 2 days   |
| **3** | Promote-from-incident button; incident ↔ ticket linking                    | 1 day    |
| **4** | `vendors` table + vendor picker + costs + invoice upload + `vendorTimeEntries` schema + ops-side manual time-entry UI + `vendorBillingMode` (hourly/flat) | 3 days   |
| **4.5** | Vendor self-service clock-in/out (auth'd mobile link, photo + geo proof) | 3 days |
| **5** | Trello sync (separate Maintenance board)                                   | 1 day    |
| **6** | Recurring/preventive (`recurrence`, `nextDueAt`, auto-respawn)             | 2 days   |
| **7** | Property detail tab + dashboard KPI + calendar view                        | 2 days   |

Phases 1–3 are MVP; 4–7 ship incrementally without re-architecture.

---

## 9. Decisions (resolved 2026-04-28)

1. **Owner approval gate — YES, ship it.**
   Add `requiresOwnerApproval: v.optional(v.boolean())` on
   `maintenanceTickets` and a new status `approval_pending` in the state
   machine. Transition rules:
   - `triage` → `approval_pending` (when `requiresOwnerApproval` is true)
   - `approval_pending` → `scheduled` (approval granted)
   - `approval_pending` → `cancelled` (approval denied)
   The flag is set manually by ops at triage time in v1; auto-flagging
   based on cost is **explicitly out of scope** (see #2).
   The actual notify-owner / collect-approval mechanism stays a manual
   ops task in v1 — the system just blocks the workflow and records the
   decision. Building owner-portal sign-off is deferred until the
   billing flow (#2) lands.

2. **Cost cap — DEFERRED to billing-flow design (separate effort).**
   We will *not* add an auto-block on cost in maintenance. Maintenance
   costs are part of a much larger problem we have not yet designed:

   > **Property-owner billing flow.** As a property management company,
   > J&A incurs costs against a property (maintenance, supplies, rent
   > collected from tenants, etc.) and bills the property owner.
   > Operational costs (J&A overhead) and pass-through costs
   > (maintenance, owner-payable items) must be **clearly separated**,
   > with rents flowing through to the owner net of pass-throughs.

   This needs its own design doc (`Docs/YYYY-MM-DD-property-owner-
   billing-flow.md`) covering: cost categorization, owner statements,
   rent collection, pass-through reconciliation, and reporting.
   Maintenance ticket costs will eventually feed that flow — keep the
   `estimatedCostCents` / `actualCostCents` / `invoiceStorageId` fields
   so data is captured now, but no automated billing/approval logic
   ships until the billing design exists.

3. **Vendors table — ship in Phase 4** (per recommendation).
   Freeform `vendorContact` is a stopgap; the `vendors` table arrives
   alongside cost capture so we don't accumulate dirty data. Phase 4
   scope therefore includes:
   - `vendors` table (name, phone, email, specialty, hourly rate,
     insurance docs storage id)
   - migration of any freeform `vendorContact` strings into rows
   - vendor picker on ticket detail

4. **Trello sync — keep running for now.**
   Native admin UI does not retire Trello. Both surfaces stay in sync
   via the existing `syncToTrello` action pattern. Revisit retirement
   once admins confirm they no longer use the Trello board day-to-day
   (track in a follow-up review, not in this plan).

5. **Hospitable webhook routing — default: always through incidents.**
   Checkout-time auto-detected issues create incidents first; ops then
   promotes to a maintenance ticket if real work is needed. Keeps a
   single intake funnel and avoids duplicate paths.

---

## 9b. Backlog signals folded in

Reviewed [product-backlog/](product-backlog/) on 2026-04-28. Items that
shape this plan:

- **Multi-quote → owner-approval workflow** (product-ideas-draft.md L274).
  The real-life flow is: ops collects 2–3 vendor quotes → emails owner
  with options → owner picks one → billing acts on the approved choice.
  This confirms `requiresOwnerApproval` is the right primitive, but the
  *quote-collection* and *owner-approved-choice* parts belong with the
  **property-owner billing flow** (§9.2), not here. v1 records the
  approval decision; quotes/choices live in the billing design.
- **Vendor time tracking — "vendor clocks in / clocks out"**
  (product-ideas-draft.md L198, clarified by CEO 2026-04-28).
  Some vendors are paid hourly, not flat-rate. We need a way for the
  **vendor** (not an internal staff member) to clock in on arrival
  and clock out on departure for a given maintenance ticket, so that:
  1. We pay the vendor accurately based on logged time.
  2. We pass that cost through to the property owner with **proof of
     work** (timestamped clock-in/out, ideally with photos and/or
     geolocation).
  3. We have an auditable record if the owner disputes a charge.

  This is a **vendor-side capability**, not an internal-staff
  timesheet. The vendor exists only in the `vendors` table — they are
  *not* a row in `users`. They will eventually need a lightweight
  authenticated surface (mobile-friendly link / PIN / magic link sent
  to their phone) to clock in/out against a specific ticket.

  **Schema implication for Phase 4** (`vendors` table arrival): add a
  sibling table

  ```ts
  vendorTimeEntries: defineTable({
    maintenanceTicketId: v.id("maintenanceTickets"),
    vendorId: v.id("vendors"),
    clockInAt: v.number(),
    clockOutAt: v.optional(v.number()),
    durationMinutes: v.optional(v.number()),  // computed on clock-out
    clockInPhotoId: v.optional(v.id("photos")),   // proof of arrival
    clockOutPhotoId: v.optional(v.id("photos")),  // proof of departure
    clockInGeo: v.optional(v.object({ lat: v.number(), lng: v.number() })),
    clockOutGeo: v.optional(v.object({ lat: v.number(), lng: v.number() })),
    notes: v.optional(v.string()),
  })
    .index("by_ticket", ["maintenanceTicketId"])
    .index("by_vendor", ["vendorId"]),
  ```

  And add `vendorBillingMode: v.union(v.literal("hourly"), v.literal("flat"))`
  + `vendorHourlyRateCents` to the `vendors` table.

  **What ships in Phase 4:** the schema above + an ops-facing manual
  time-entry UI (ops records vendor's hours after the fact).

  **What is deferred to its own phase ("Phase 4.5 — vendor portal"):**
  the vendor-authenticated mobile surface where the vendor clocks
  themselves in/out. Tied loosely to the property-owner billing flow
  (§9.2) because the proof-of-work artifacts feed owner statements.
- **Shareable ticket deep links** (product-ideas-draft.md L426).
  Ops want to copy a ticket URL into WhatsApp/Slack so a team member
  can open it directly. v1 ticket detail pages should have stable
  shareable URLs (`/maintenance/[id]`); a "Copy link" button is a
  cheap add in Phase 2.
- **Recurring/preventive work is real** (product-ideas-draft.md L482,
  hot-tub service $80/week). Reinforces keeping `recurrence` /
  `nextDueAt` in the v1 schema even though the *UI* for it ships in
  Phase 6.
- **Geolocation for maintenance staff** (product-backlog.md L10).
  Tracked as future scope alongside cleaner geolocation; not part of
  this plan.
- **Separate Trello board** (product-ideas-draft.md L259). Already
  reflected — Maintenance gets its own board, not the Incidents one,
  because notification volume was a complaint.

## 10. Out of scope (explicitly)

- Vendor self-service portal
- Parts inventory tracking
- Warranty document management
- Maintenance budget rollups (handled by Reports section once it lands)
- Mobile cleaner UI for maintenance tickets
- **Automated property-owner billing / cost-cap rules** — owned by the
  separate property-owner billing flow design (not yet started)
- **Owner-portal sign-off UI** for `approval_pending` tickets — v1
  records the decision manually; portal arrives with the billing flow
- **Multi-vendor quote collection & owner-picks-one workflow** — owned
  by the property-owner billing flow (see §9.2 and §9b)
- **Vendor self-service clock-in/out portal** — the authenticated
  mobile surface where the *vendor themselves* clocks in on arrival
  and out on departure (with photo + geo proof of work). Phase 4
  ships the data model and an ops-side manual entry UI; the vendor
  portal is a follow-on phase ("4.5") tied to the property-owner
  billing flow.
- **Maintenance-staff geolocation** — tracked alongside cleaner
  geolocation in the broader "all-users geolocation" backlog item

---

## Acceptance criteria for v1 (phases 0–3)

- [x] `/maintenance` route exists and is reachable from sidebar for
      `admin`, `property_ops`, `manager`.
- [ ] `maintenanceTickets` table deployed; both apps' Convex codegen
      regenerated and committed (per CLAUDE.md ownership rule).
- [ ] An ops user can create a ticket manually from `/maintenance/new`.
- [ ] An ops user can promote a `maintenance_needed` incident to a ticket
      from the incident detail page; the incident gains a "View work"
      link to the ticket.
- [ ] Ticket detail page renders the full status flow with allowed
      transitions; disallowed ones are not selectable.
- [ ] `requiresOwnerApproval` toggle on triage forces the next status
      to `approval_pending`; recording approval/denial transitions to
      `scheduled` or `cancelled` and stamps `ownerApprovalDecidedAt/By`.
- [ ] Closing (verifying) a ticket prompts to also resolve the linked
      incident; default is yes.
- [ ] List filters by status, property, category, priority.
- [ ] Bilingual labels (en/es) for nav, status, category, priority.
