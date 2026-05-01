# Requirements

Distilled from:
- `Docs/product-backlog/product-backlog.md` lines 9, 13, 14–15
- `Docs/product-backlog/product-ideas-draft.md` lines 304–350, 392–426
- Founder conversation 2026-04-28 (this thread)

Each requirement is tagged with a slice (M1 / M2 / M3) — see `implementation-plan.md`.

---

## R1. Ad-hoc tasks anchored to calendar cells *(M1)*

> "On the calendar, there should be a tiny plus sign in each box. Click plus, add a task. Like, I'm working on an Airbnb claim — I create a task for myself: 'Airbnb claim tracking,' write the details, mark it complete when done." — *product-ideas-draft.md:304*

- **Where:** Schedule page, every `(day × property)` cell.
- **Affordance:** small `+` button inside the cell. Adjacent count badge if tasks exist (`+` and `3` side by side).
  - Click `+` → create-task drawer.
  - Click count → task list scoped to that cell.
- **Scope of a task created here:** belongs to that property on that day (anchor date = the cell's date).
- **Authoring fields (v1):** title, description, assignee (ops user), due date (defaults to cell date), priority.

## R2. Tasks linkable to other entities *(M1)*

> "It could be a task of the job, then you have to create a task inside there so it links with the job. But if it's about the property on that day, it's in the box." — *product-ideas-draft.md:319*

- A task may optionally link to: `propertyId`, `jobId` (cleaningJob), `incidentId`, `workOrderId`, `conversationId`.
- A task with **no property** is a personal/global ops task (still appears on the day's row but not on the schedule grid).
- From the linked entity's detail page, the task appears in a "Related tasks" section.

## R3. Visual persistence: tasks "drag" across the schedule until closed *(M1, locked)*

> *Confirmed 2026-04-28:* the cross-day progress bar is the whole point — accept the "expensive UI" tradeoff.


> "Once you have a task and it stays in one box, you might forget it. I want it the way the days are going forward, the task is pulling along — a red line stretching across days. It makes the dashboard look dirty, but it also tells you this task took 4 days." — *product-ideas-draft.md:322*

- An open task with `anchorDate < today` renders as a **bar that spans from anchor date through today** in the schedule grid.
- Color encodes age/urgency (calm → soon → urgent), reusing the `CountdownBadge` design tokens.
- On close, the bar stops growing and freezes at `closedAt`. Closed tasks may be hidden by a toggle.
- Concern raised: at 70+ properties this gets noisy. **Mitigation:** open-tasks-only view + per-assignee filter (R6).

## R4. Open-tasks tab and search *(M1)*

> "They need a tab that just says 'open tasks' so you can see all open tasks. Click → takes you to the calendar day and task." — *product-ideas-draft.md:326*
> "In the search bar, search by name. 'Hasid' → see Hasid's open tasks." — *product-ideas-draft.md:330*

- Dedicated `/tasks` route with filters: status, assignee, property, age, due date, linked entity.
- Global search supports tasks (by title, assignee, property).
- Clicking a task result deep-links to its calendar cell with the task drawer open.

## R5. Status lifecycle *(M1)*

Minimum for v1: `open → in_progress → done`.
- `open` — created, not started
- `in_progress` — picked up by assignee
- `done` — closed; bar stops dragging
- *(Deferred to M2:)* `blocked`, `handed_over`, `cancelled`

Closing requires only a click in v1 — no mandatory note/proof. *(Open question OQ-4.)*

## R6. Assignment & visibility *(M1)*

- **Create / assign / delete:** roles `admin`, `property_ops`, `manager` only.
- **Assignable to:** ops roles **and cleaners** *(decided 2026-04-28)*. Real-world example: order/pick-up of a refill is a cleaner task, not a job.
- **Cleaner permissions on a task assigned to them:** view, update status (`open → in_progress → done`), add comment, attach photo. **Cannot** create, reassign, edit core fields, or delete.
- **Visibility:** any ops user sees all ops tasks. Cleaners see only tasks assigned to them. No private/draft tasks in v1.
- **Mobile cleaner app:** v1 ships a "My tasks" screen (list + detail + status + comment + photo). Promoted from M3 stretch into M1 because cleaner-assigned tasks make no sense without a cleaner-side surface.

## R7. Notifications *(M1, light)*

- In-app toast + dashboard count when a task is assigned to you.
- Dashboard "Tasks" card shows: my open tasks count, top 3 by priority/age.
- *(Push/email: deferred to M2; OQ-5.)*

## R8. Shift handover summary *(M2)*

> "When I sign in to my admin day, I receive a little handoff: here's what happened today, here's a cleaning upcoming, here's a task. A summary so the next person picks up where I left off." — *product-ideas-draft.md:419*
> "We want a system where I can hire 10 people, anywhere in the world, working simultaneously. I don't want to manually call Abdullah. Whoever logs in after sees it there." — *product-ideas-draft.md:426*

- On sign-in, the dashboard surfaces a **"Since you were last here"** panel, scoped to the user.
- Contents (mix of system-generated digest + free-form note from outgoing person):
  - Tasks newly assigned to me
  - Tasks I owned that changed status
  - New incidents (critical/high) on properties I'm watching
  - New "handover note" left by another ops user (free text, **required** in v1)
- Outgoing user writes the handover from a "Sign out & hand off" action — captured as a `handoverNote` row (separate from tasks, but may *reference* tasks by id).

## R12. Voice-dictated handover notes *(M2, v1 of handover)*

> *Decided 2026-04-28:* "the microphone feature is included so that the person can actually just drop the handover off by talking."

- The handover dialog includes a **microphone button** that starts/stops dictation.
- Web: use the browser **SpeechRecognition API** (Web Speech) — no server-side processing, no audio storage, transcript is inserted directly into the textarea.
- Mobile (cleaners-app, ops users on phones): use Expo's speech-to-text equivalent (`expo-speech-recognition` or platform-native).
- Transcript is **fully editable** after dictation (typo cleanup, formatting).
- Language follows the user's UI locale (en/es) — set `recognition.lang` accordingly.
- Fallback: if the browser doesn't support SpeechRecognition, the mic button is hidden; user types as normal.

## R13. Minimum handover checklist *(deferred to M2.5 / "v2 of handover")*

> *Decided 2026-04-28:* "we are going to add checklists of specific items that we want each handover to include with every minimal checklist… so that each person handover ensures the basic checks before handing over."

- A small (3–7 item) **fixed checklist** the outgoing user must tick before submitting handover.
- Items are configurable by admins (e.g. "checked overnight incidents," "verified tomorrow's first cleanings have an assignee," "responded to all unread guest messages").
- Schema reserves space in v1: `handoverNotes.checklistResponses?: Array<{ itemKey: string; checked: boolean }>` left empty until v2.
- v2 ships a settings page for admins to define the checklist + the UI in the handover dialog.

## R9. Recurring tasks via templates *(M3)*

> "Trash in / trash out — has to be populated throughout the year, once a week. We should have a template, a checklist. Schedule it on a recurring basis. Mondays and Tuesdays for Abdullah." — *product-ideas-draft.md:392, 414*

- A `taskTemplate` defines: title, description, default assignee (or role), checklist items, scope (property-specific or portfolio-wide).
- A `taskRecurrence` ties a template to a cron-like schedule (e.g. `WEEKLY MON,TUE` per property).
- Convex cron generates concrete `tasks` from templates ahead of time (e.g. 14-day rolling window).

## R10. External shareable links *(M3 stretch)*

> "Can we copy the link of a task and send it on WhatsApp? From the team, somebody can click the link and the task opens." — *product-ideas-draft.md:426*

- Each task has a stable URL that opens the task drawer (deep link).
- Logged-in ops users see the full task; unauthenticated visitors see a sign-in wall (no public sharing in v1).

## R11. Mobile parity (read-only first) *(M3)*

- The cleaners app does not need full task UI in v1.
- *Optional:* mobile-side **read-only** view of "tasks assigned to me" for ops staff who use the mobile app — but ops mostly works on web, so this is low priority.

---

## Non-goals (re-affirmed)

- No Gantt, no dependencies, no sub-tasks (a task is a leaf).
- No SLA breach alerts in v1 (overdue is just visual via R3).
- No time tracking on tasks (no start/stop timer).
- ~~No cleaner-side task assignment in v1.~~ **Reversed 2026-04-28** — cleaners *are* assignable; mobile gets a "My tasks" screen in M1.
