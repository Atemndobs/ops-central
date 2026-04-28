# Ops Tasks & Shift Handover

**Status:** Planning · extracted from product backlog 2026-04-28
**Owner:** Bertrand (CEO)
**Related backlog items (now superseded by this folder):**
- "Adding Tasks to schedule (task per day per property)"
- "Recurring Tasks (e.g. Trash) — add to Schedule, schedulable templates"
- "Handoff for Ops — summary of last shift, could be linked to tasks"

---

## What this is

A unified work-tracking layer for **ops staff** (admin, property_ops, manager) covering two intertwined problems:

1. **Ad-hoc and recurring tasks** that don't fit cleanly into the existing `cleaningJobs` / `incidents` / `workOrders` models — e.g. "follow up on Airbnb claim for Berlin," "trash in/out every Monday," "call landlord about Houston-Lisboa lock."
2. **Shift handover between ops people** — when one ops staffer signs out and another signs in (across timezones / overlapping shifts), the incoming person should see in 30 seconds: *what's open, what changed, what to do first.*

The thesis (from the founders' product-ideas conversation): tools like Asana/Trello fail this domain because they treat tasks as isolated cards. We want tasks **anchored to the operational calendar** (a date × property cell), visually persistent until closed (so they "drag" across the schedule and force attention), and tightly linked to the rest of OpsCentral (jobs, incidents, work orders, properties, conversations).

## Why this is a separate concept (not just bigger jobs)

| Existing concept | What it covers | Why tasks are different |
|---|---|---|
| `cleaningJobs` | Scheduled cleaner work, defined SLA, status lifecycle, payable | Tasks are work the *ops team* does, often invisible to cleaners |
| `incidents` | Reports filed by cleaners (damage, missing items) | Tasks may originate from incidents but track follow-up across days/weeks |
| `workOrders` | Maintenance dispatched to vendors | Tasks include guest-comms, financial follow-ups, claims, recurring chores — not just maintenance |
| `conversations` | Property-scoped messaging | Tasks need a status, an assignee, a due date, and a closure action |

Tasks are the **"everything else ops does"** layer.

---

## Folder contents

- `README.md` — this file (overview + intent)
- `requirements.md` — distilled requirements (R1–R13) with citations to the source conversations
- `architecture.md` — data model, Convex surface, UI surface, dashboard integration, voice dictation
- `implementation-plan.md` — phased rollout (M1 tasks + cleaner mobile → M2 handover w/ voice → M2.5 handover checklist → M3 templates/recurring)
- `decisions.md` — one-line snapshot of every resolved question (the WHAT)
- `open-questions.md` — full discussion of each decision with alternatives passed on (the WHY)

---

## Reading order

1. `decisions.md` — fastest way to see what we picked
2. `requirements.md` — *what* we're building and the user need behind each slice
3. `architecture.md` — *how* the system fits together
4. `implementation-plan.md` — *when* and *in what order* we build
5. `open-questions.md` — *why* each decision went the way it did (alternatives, trade-offs)

## Out of scope (explicitly)

- Replacing Slack/WhatsApp internal team chat — those stay where they are
- Replacing `cleaningJobs` (cleaners' work continues to live there)
- Time-clock / hourly payroll for ops staff
- Public-facing task sharing or guest-visible tasks
- Full project-management features (Gantt, dependencies, sprints)
