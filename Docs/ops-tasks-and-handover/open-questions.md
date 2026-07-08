# Open Questions

> **Status: ALL RESOLVED as of 2026-04-28.** This document is preserved as the decision record. Each question shows the chosen answer and the original alternative for future re-litigation.

---

## OQ-1. Can a task have *no* property?

**Decided 2026-04-28: YES.** Global ops tasks exist (e.g. "review Q2 invoicing," "draft owner report template"). They appear on `/tasks` and the dashboard, but not on the schedule grid. `propertyId` is optional in schema.

---

## OQ-2. Are cleaners assignable to tasks?

**Decided 2026-04-28: YES.**

Real-world ops example: ordering a refill, picking up a refill — these get assigned to cleaners. Cleaners are first-class assignees alongside ops staff.

**Implications now in scope:**
- Cleaner mobile app gets a "My tasks" screen in v1 (read + status update + comment), not deferred to M3.
- Push notification on assignment to a cleaner.
- Distinction from `cleaningJobs`: jobs are scheduled cleanings with checklists/photos/SLA; tasks are lighter ad-hoc errands. Both can coexist for the same cleaner on the same day.
- Permission split: cleaners can **update status** and **comment** on tasks assigned to them; only ops roles can **create/assign/delete**.

---

## OQ-3. Status set: minimal vs. expressive?

**Decided 2026-04-28: minimal v1 (`open → in_progress → done`)** — confirmed.

**But also decided:** the **drag-across progress bar is a v1 feature, not deferred** (cross-references OQ-10). Bar spans from `anchorDate` to `closedAt ?? today`, color tier from CountdownBadge tokens, makes long-running tasks visually obvious. The "expensive UI" framing is accepted — visibility is the whole point.

---

## OQ-4. Does closing a task require evidence?

**Decided 2026-04-28: NO in v1.** One click closes; `closedBy` + `closedAt` always recorded. Revisit in M3 with an admin-toggleable rule ("require closure note for tasks linked to incidents") if patterns of premature-close emerge.

---

## OQ-5. Notifications channel for v1?

**Decided 2026-04-28:**
- **Web ops users:** in-app toast + dashboard count.
- **Cleaners:** Expo push on assignment (reuses existing pipeline used for `cleaningJobs.assign`, distinct event type so users can mute one without the other).
- **Email digest:** deferred to M2 as part of handover work (sent at shift-end via Resend).
- **No SMS** in any milestone — too noisy, no ROI.

---

## OQ-6. Shift definition

**Decided 2026-04-28: NO formal shifts in v1.** Use `userPresence.lastSeenAt` (bumped on dashboard load) and `lastSignedOutAt` (set on explicit "Sign out & hand off"). Panel reads "Since you were last here at *Tue 2:14 pm*." Formal shift schedules revisit when ops headcount ≥ 5.

---

## OQ-7. Handover note authoring

**Decided 2026-04-28:**

- **v1: free-form text only** (plus the auto-generated activity digest beside it).
- **v1 must include voice-to-text** — outgoing person can dictate the handover by tapping a microphone icon. Browser SpeechRecognition API (Web Speech) on web; native speech APIs on mobile. Text is editable after dictation.
- **v2: minimal handover checklist** — small list of "did you check X?" items the outgoing person ticks before submitting. Ensures every handover hits a baseline regardless of how brief the free text is. Not in v1, but the schema should leave room (`checklistResponses` field on `handoverNotes`).

---

## OQ-8. Tasks card on dashboard — what does it show post-launch?

**Decided 2026-04-28: stacked sections, no tabs.**

```
┌── Tasks ─────────────────────────── New ─┐
│ My open: 7  ·  Handover: 3 new           │
│                                          │
│ • Airbnb claim — Berlin   urgent         │
│ • Trash in — Houston      soon           │
│ • Confirm dishwasher fix  calm           │
│                                          │
│ View all  ·  Hand off shift              │
└──────────────────────────────────────────┘
```

Top: two link-counts. Body: top 3 tasks sorted `(priority desc, age desc)`. Footer: list link + handover dialog trigger.

---

## OQ-9. Recurring task population window

**Decided 2026-04-28: 14 days ahead, hourly cron, idempotent on `(templateId, anchorDate, propertyId)`.** Survives a half-day cron outage; pausing a recurrence doesn't leave 6 months of orphan rows.

---

## OQ-10. Schedule cell density at 70+ properties

**Decided 2026-04-28: intensify with cap + escape valves.**

- **Color tiers (capped, no further escalation past urgent):** calm `<2d` → soon `<5d` → urgent `≥5d`. No pulsing, no flashing.
- **v1 escape valves (all default ON):**
  - Open-tasks-only filter.
  - Mine-only toggle.
  - Per-city / property-cluster collapse.
- Honors "make the dashboard dirty" intent without becoming visual chaos at 70+ properties.

---

## OQ-11. Bilingual content

**Decided 2026-04-28: store user-authored text as-is.** UI chrome lives in `messages/{en,es}.json`. Add `authoredLocale: "en" | "es"` to `opsTasks` and `handoverNotes` so a future "translate this for me" button is additive, not a migration.

---

## OQ-12. Where do portfolio-wide / global tasks live on the schedule?

**Question:** Some tasks ("supplies day", "send monthly owner statements") apply to the whole portfolio, not a single property. They have no `propertyId`. Where do they render in the schedule UI so they're not invisible?

**Alternatives considered:**

- **A. Force-attach to every property.** Creates N rows per task — explodes the grid; closing one row vs all is ambiguous.
- **B. Separate `/portfolio-tasks` page.** Disconnects from the dated workflow — operators forget about them.
- **C. Render on the date-header row of the schedule.** Same `+`, count, drag-across, avatar stack as per-property cells, but in the header row above the property grid.

**Decided 2026-05-01: C.** The date-header row already exists visually. Adding the same affordances there makes the global lane discoverable in the same place operators already look. Quick-create from the header pre-omits `propertyId`. Drag-across bars on global tasks span the header row, not any property row, so they don't get visually conflated with per-property work.

**Implication:** no schema change (`propertyId` is already optional). New queries `listForDateRow` and `listGlobalRange` mirror the per-property ones.

---

## OQ-13. How do operators see who's responsible for tasks in a cell at a glance?

**Question:** With the count badge alone, ops can see *that* a cell has tasks but not *whose* tasks. At shift change especially, "are these mine, are these the new hire's?" matters before opening any popover.

**Alternatives considered:**

- **A. No avatars — count only.** Status quo. Forces a popover open for any cell with tasks.
- **B. One avatar per task.** A cell with 6 tasks for one cleaner = 6 identical faces. Useless.
- **C. One avatar per distinct assignee, capped at 3 + `+N` overflow.** Unassigned tasks collapse to a single ghost avatar.

**Decided 2026-05-01: C.** Five distinct assignees → 3 avatars + `+2` chip, overlapping ~40%. Reuses the existing user-avatar primitive. Closed tasks contribute nothing. Click an avatar → cell popover filters to that user; `+N` chip → unfiltered popover.

**Implication:** new query `listAssigneeAvatarsForRange` returns a slim `(cellKey, anchorDate, assignees[], unassignedCount)` payload — one round trip per visible window — instead of bloating `listForCell`. The `hydrate()` projection picks up `assignee.avatarUrl` for free.

