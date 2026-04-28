# Implementation Plan

Three milestones, each shippable on its own. Stop after any milestone if priorities change.

---

## M1 — Tasks foundation *(target: ~7–10 working days)*

**Goal:** Ops can create, assign (to ops **or cleaners**), find, and close ad-hoc tasks anchored to the schedule. Dashboard surfaces my open tasks. Cleaner mobile app receives task assignments.

> *Updated 2026-04-28:* mobile cleaner-side "My Tasks" screen pulled into M1 because cleaners are now assignable (OQ-2). +2–3 days of scope vs. original estimate.


### Backend
1. Add `opsTasks` table + indexes (architecture §1), including `assigneeRole` denormalization.
2. Implement `convex/opsTasks/queries.ts` and `mutations.ts`. Include `addComment` and `attachPhoto` in M1 (cleaners need them on mobile).
3. Add `requireOpsRole(ctx)` (reuse) and new `requireTaskActor(ctx, taskId)` helper for cleaner-allowed mutations.
4. Push-notification dispatch on assign (web → mobile) — reuse existing Expo push pipeline used for `cleaningJobs.assign`, distinct event type.
5. Seed script for staging: ~20 sample tasks across the existing test properties, mix of cleaner- and ops-assigned.

### Frontend — schedule grid
5. Build `TaskQuickCreateDrawer` and `TaskCellListDrawer`.
6. Add `+` button + count badge to each schedule day-cell.
7. Build `TaskOverlayBar` and integrate into the schedule grid (drag-across).
8. Add "open tasks only" toggle (default ON) and "mine only" toggle.

### Frontend — list + detail
9. Build `/tasks` page with filter sidebar (status, assignee, property, age).
10. Build `/tasks/[taskId]` modal-on-route detail with status transitions.
11. Add tasks to global search.

### Dashboard
12. Replace the placeholder Tasks card with `<TasksCard />` (counts + top 3 + links).
13. Add in-app toast on task assignment (reuse `toast-provider`).

### Translations
14. Extend `messages/en.json` and `messages/es.json` with all task-related copy under `tasks.*`.

### Mobile (cleaner app) — *new in M1*
15. `app/(cleaner)/tasks/index.tsx` — list of tasks where `assigneeId === me`, filtered by status tab.
16. `app/(cleaner)/tasks/[taskId].tsx` — detail with status buttons, comment thread, photo attach.
17. Add **Tasks** tab to cleaner bottom-nav (next to Jobs).
18. Wire push notification handler to deep-link into task detail.
19. Permission gating client-side: hide edit/assign affordances for cleaner role (server enforces too).

### Tests / verification
20. Convex unit tests on mutations (ops auth + cleaner-assignee permission split).
21. Playwright/Chrome-DevTools-MCP smoke (web): create task from cell → assign to cleaner → see it on dashboard → close it → count drops.
22. Manual cleaner-app smoke on a test device: receive push → open task → mark in_progress → add photo → mark done.

### Acceptance for M1
- Ops user creates a task from a schedule cell in < 10s, can assign to either ops user or cleaner.
- An open task created 3 days ago renders as a 4-day bar (drag-across confirmed visible).
- Dashboard shows my-open count and clicking a row deep-links to detail.
- Cleaner receives push, opens task on mobile, can change status and comment but not edit fields.
- en/es both render fully on web and mobile.

---

## M2 — Shift handover (free-form + voice) *(target: ~4–5 working days; depends on M1)*

**Goal:** Incoming ops staff get a 30-second read of what changed and what's pending. Outgoing user can dictate the handover.

### Backend
1. Add `userPresence` table + `touch()` / `signOut()` mutations.
2. Add `handoverNotes` table (with `bodySource` and reserved `checklistResponses` field) + create/acknowledge mutations.
3. Reserve `handoverChecklistConfig` table + a query (no UI yet — populated in M2.5).
4. Add `opsTasks/queries.getActivityForUser(userId, since)` returning a structured diff.
5. Wire `userPresence.touch()` to the dashboard's auth-success effect.

### Frontend
6. Build `<HandoverPanel />` on the dashboard for first-load-after-absence.
7. Build `<SignOutHandoffDialog />` triggered from the user menu and from `<TasksCard />` footer.
   - **Includes microphone button** (R12): Web Speech API on web, `expo-speech-recognition` on mobile. Feature-detect; hide if unavailable.
   - Pre-fills a draft from recent task activity.
   - Sets `bodySource` to `typed` / `dictated` / `mixed` based on input method.
8. Add `/ops-handover` route showing the last 7 days of handover notes (audit trail).

### Translations / UI
9. Extend message catalogs (`handover.*`), including mic button label, "listening…" state, and unsupported-browser fallback.

### Acceptance for M2
- Ops user A signs out with a typed note → user B signs in 4 hours later → sees panel with note + diff → acknowledges → panel collapses.
- Ops user A taps mic, dictates 3 sentences in en or es → text appears in textarea → can edit → submit.
- An ops user gone for 3 days sees a "you've been gone a while" mode that paginates older notes.

---

## M2.5 — Handover minimum checklist *(target: ~2 working days; depends on M2)*

**Goal:** Force every handover to confirm a baseline before submission, so handovers don't degrade to one-line "all good" notes.

### Backend
1. Build mutations on `handoverChecklistConfig` (admin-only).
2. Update `handoverNotes.create` to require all `required: true` items checked when config has any active items.

### Frontend
3. Settings page: `/settings/handover-checklist` — admin CRUD (label en/es, required toggle, order).
4. `<SignOutHandoffDialog />` renders the checklist from config above the textarea; submit disabled until required items are checked.

### Acceptance for M2.5
- Admin defines a 4-item checklist in settings.
- Outgoing user sees those 4 items in the dialog; can't submit until required ones are ticked.
- Optional items render but don't gate submit.

---

## M3 — Recurring tasks & templates *(target: ~4–5 working days; depends on M1)*

**Goal:** Recurring chores (trash in/out, weekly checks) self-populate without manual creation.

### Backend
1. Add `opsTaskTemplates` and `opsTaskRecurrences` tables.
2. Build `convex/crons.ts` job: hourly, materialize task instances 14 days ahead, idempotent on `(templateId, anchorDate, propertyId)`.
3. Add CRUD for templates and recurrences.

### Frontend
4. `/ops-templates` list + editor.
5. From schedule, surface materialized recurring tasks identically to ad-hoc tasks (no UI distinction except a small "recurring" tag and a link back to the template).
6. Stretch: clone-from-template button on quick-create drawer.

### Acceptance for M3
- Define a "Trash in/out, every Monday" template tied to property X → next 2 Mondays appear as tasks → closing one does not affect the next.

---

## Cross-cutting work (any milestone)

- **Telemetry:** count task creations, average time-to-close, % closed within 24h, % handovers using voice dictation, % handovers acknowledged within first hour of next sign-in. Reuse PostHog events pattern from existing pages.
- **Audit log:** append-only entries for create/assign/status changes (could piggyback on existing audit infra if present, else table).
- **Permissions matrix doc:** add to `Docs/security/` once roles are confirmed.
- **Notification routing (OQ-5):** in-app toast for ops, Expo push for cleaners on M1; email digest via Resend introduced in M2 alongside handover.
- **Authored locale (OQ-11):** populate `authoredLocale` from current `useLocale()` value at write time on both `opsTasks` and `handoverNotes`. No translation in v1.

---

## Sequencing rationale

- **M1 before M2** because handover is meaningless without tasks to hand over.
- **M2 before M2.5** because the free-form handover is the primary unblocker; the checklist is a behavior-shaping refinement that benefits from real handover usage data first.
- **M3 last** because templates/recurrence add real complexity (cron, idempotency, UI for rules) but are not blocking ops productivity — manual task creation works for a 4-property portfolio today.
- **Mobile cleaner-side now in M1** (was deferred). Decision 2026-04-28: cleaners are assignable to tasks, so they need a task surface or assignments are dead letters.

---

## Definition of Done (overall)

- All four open-question categories (`open-questions.md`) explicitly answered before M1 plan-phase ends.
- Each milestone has a verification report (Convex tests + UI smoke) before merging to `main`.
- `Docs/ops-tasks-and-handover/` updated with a `decisions.md` capturing what we picked vs. what we deferred.
- Product backlog (`Docs/product-backlog/product-backlog.md`) entries for tasks/recurring/handover removed and replaced with a pointer to this folder.
