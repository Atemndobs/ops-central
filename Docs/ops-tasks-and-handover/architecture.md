# Architecture

> **Caveat:** assumes the proposed defaults in `open-questions.md`. Each answered differently shifts specific pieces — flagged inline as `[OQ-N]`.

---

## 1. Data model (Convex)

### `opsTasks`

```ts
opsTasks: defineTable({
  // Identity
  title: v.string(),
  description: v.optional(v.string()),                // markdown
  status: v.union(
    v.literal("open"),
    v.literal("in_progress"),
    v.literal("done"),
  ),                                                  // [OQ-3]
  priority: v.union(
    v.literal("low"),
    v.literal("normal"),
    v.literal("high"),
    v.literal("urgent"),
  ),

  // Calendar anchoring (R1, R3)
  anchorDate: v.number(),                             // start-of-day UTC ms
  dueDate: v.optional(v.number()),                    // optional explicit due
  closedAt: v.optional(v.number()),

  // Assignment
  createdBy: v.id("users"),
  assigneeId: v.optional(v.id("users")),              // ops users OR cleaners [OQ-2 decided: yes-cleaners]
  assigneeRole: v.optional(v.union(                   // denormalized for fast filtering
    v.literal("admin"),
    v.literal("property_ops"),
    v.literal("manager"),
    v.literal("cleaner"),
  )),

  // Linking (R2) — all optional
  propertyId: v.optional(v.id("properties")),         // [OQ-1: nullable]
  jobId: v.optional(v.id("cleaningJobs")),
  incidentId: v.optional(v.id("incidents")),
  workOrderId: v.optional(v.id("workOrders")),
  conversationId: v.optional(v.id("conversations")),

  // Recurrence (R9, M3)
  templateId: v.optional(v.id("opsTaskTemplates")),

  // Locale (OQ-11): record what the author wrote in, never auto-translated
  authoredLocale: v.optional(v.union(v.literal("en"), v.literal("es"))),

  // Audit
  createdAt: v.number(),
  updatedAt: v.number(),
  closedBy: v.optional(v.id("users")),                // OQ-4: always recorded on close
})
  .index("by_assignee_status", ["assigneeId", "status"])
  .index("by_property_anchor", ["propertyId", "anchorDate"])
  .index("by_anchor_status", ["anchorDate", "status"])
  .index("by_status_priority", ["status", "priority"])
  .index("by_template", ["templateId"]);
```

### `opsTaskComments` *(M2)*

```ts
opsTaskComments: defineTable({
  taskId: v.id("opsTasks"),
  authorId: v.id("users"),
  body: v.string(),                                   // markdown
  createdAt: v.number(),
}).index("by_task", ["taskId", "createdAt"]);
```

### `opsTaskTemplates` *(M3)*

```ts
opsTaskTemplates: defineTable({
  name: v.string(),
  title: v.string(),                                  // template for task.title
  description: v.optional(v.string()),
  defaultAssigneeId: v.optional(v.id("users")),
  defaultPriority: v.union(/* ... */),
  checklist: v.optional(v.array(v.object({
    label: v.string(),
    required: v.boolean(),
  }))),
  scope: v.union(
    v.literal("property"),                            // one instance per property
    v.literal("portfolio"),                           // one instance global
  ),
  active: v.boolean(),
  createdBy: v.id("users"),
  createdAt: v.number(),
}).index("by_active", ["active"]);
```

### `opsTaskRecurrences` *(M3)*

```ts
opsTaskRecurrences: defineTable({
  templateId: v.id("opsTaskTemplates"),
  propertyId: v.optional(v.id("properties")),         // null = portfolio-wide
  // RFC-5545-ish minimal subset; richer rule library later
  rule: v.object({
    freq: v.union(v.literal("daily"), v.literal("weekly"), v.literal("monthly")),
    interval: v.number(),                             // every N
    byWeekday: v.optional(v.array(v.number())),       // 0..6
    byMonthDay: v.optional(v.array(v.number())),
    timeOfDay: v.optional(v.string()),                // "09:00"
  }),
  startDate: v.number(),
  endDate: v.optional(v.number()),
  active: v.boolean(),
}).index("by_active", ["active"]);
```

### `handoverNotes` *(M2)*

```ts
handoverNotes: defineTable({
  authorId: v.id("users"),
  body: v.string(),                                   // free-form, markdown
  bodySource: v.optional(v.union(                     // R12: track origin
    v.literal("typed"),
    v.literal("dictated"),
    v.literal("mixed"),
  )),
  authoredLocale: v.optional(v.union(v.literal("en"), v.literal("es"))),  // OQ-11
  validFrom: v.number(),                              // when sign-out occurred
  validUntil: v.optional(v.number()),                 // null = until next handover
  referencedTaskIds: v.optional(v.array(v.id("opsTasks"))),
  // R13 — reserved in v1 schema, populated when M2.5 ships the checklist UI
  checklistResponses: v.optional(v.array(v.object({
    itemKey: v.string(),                              // matches handoverChecklistConfig.items[].key
    checked: v.boolean(),
    note: v.optional(v.string()),
  }))),
  acknowledgedBy: v.optional(v.array(v.object({
    userId: v.id("users"),
    at: v.number(),
  }))),
  createdAt: v.number(),
}).index("by_validFrom", ["validFrom"]);
```

### `handoverChecklistConfig` *(M2.5 — reserved key now, ships later)*

Single-document config (use a `kind` index or a fixed `_id`) so admins can edit the global checklist without a deploy:

```ts
handoverChecklistConfig: defineTable({
  items: v.array(v.object({
    key: v.string(),                                  // stable id
    label: v.string(),                                // en
    labelEs: v.optional(v.string()),                  // es
    required: v.boolean(),
    order: v.number(),
  })),
  updatedAt: v.number(),
  updatedBy: v.id("users"),
});
```

### Auxiliary: `users.lastSeenAt` *(M2)*

Add a field on the existing `users` table (or a thin sibling table to avoid widening hot rows):

```ts
userPresence: defineTable({
  userId: v.id("users"),
  lastSeenAt: v.number(),
  lastSignedOutAt: v.optional(v.number()),
}).index("by_user", ["userId"]);
```

`lastSeenAt` updates on dashboard load; `lastSignedOutAt` updates on explicit "Sign out & hand off."

---

## 2. Convex function surface

```
convex/opsTasks/
  queries.ts
    listForAssignee(userId, { status?, limit? })
    listForCell(propertyId, anchorDate)              // schedule cell drawer
    listForProperty(propertyId, { status?, range? })
    listGlobalForUser(userId, { status? })           // for /tasks page
    countOpenForUser(userId)                         // dashboard card
    getById(taskId)
    getActivityForUser(userId, since)                // diff for handover digest

  mutations.ts
    create(args)                                     // returns taskId
    update(taskId, patch)
    setStatus(taskId, nextStatus)                    // wraps timestamps
    assign(taskId, assigneeId)
    delete(taskId)                                   // soft via status?
    addComment(taskId, body)                         // M2

convex/opsTaskTemplates/                             // M3
  queries.ts
    listActive()
  mutations.ts
    create / update / archive

convex/opsTaskRecurrences/                           // M3
  mutations.ts
    create / pause / resume

convex/handoverNotes/                                // M2
  queries.ts
    getCurrentForUser(userId)
    listRecent(limit)
  mutations.ts
    create(body, referencedTaskIds?)
    acknowledge(noteId)

convex/userPresence/                                 // M2
  mutations.ts
    touch()                                          // bumps lastSeenAt
    signOut()                                        // sets lastSignedOutAt

convex/crons.ts                                      // M3
  // hourly: materialize next 14 days of recurring tasks
  generateRecurringTaskInstances
```

### Authorization

| Action | admin · property_ops · manager | cleaner |
|---|---|---|
| Create / assign / reassign / delete task | ✅ | ❌ |
| Edit core fields (title, description, due, links) | ✅ | ❌ |
| View task | ✅ all tasks | ✅ only tasks where `assigneeId === me` |
| Update status (`open / in_progress / done`) | ✅ | ✅ on own tasks |
| Add comment, attach photo | ✅ | ✅ on own tasks |
| Read/write `handoverNotes` | ✅ | ❌ |

Implement two helpers in Convex: `requireOpsRole(ctx)` (existing) and `requireTaskActor(ctx, taskId)` which permits the assignee (cleaner or ops) for status/comment mutations only. `handoverNotes*` continues to require `requireOpsRole`.

---

## 3. Routing & UI surface (Next.js App Router)

```
src/app/(dashboard)/
  page.tsx                                           # dashboard (existing)
    └─ TasksCard                                     # M1: real card replaces placeholder
  schedule/
    page.tsx                                         # existing
    └─ DayCell                                       # ADD: + button + count badge
       └─ TaskQuickCreateDrawer                      # M1
       └─ TaskCellListDrawer                         # M1
    TaskOverlayBar                                   # M1: drag-across rendering
  tasks/
    page.tsx                                         # M1: full list w/ filters
    [taskId]/
      page.tsx                                       # M1: detail (modal-on-route)
  ops-templates/                                     # M3
    page.tsx
    [templateId]/page.tsx
  ops-handover/                                      # M2
    page.tsx                                         # full handover viewer
```

### New components (sketch)

- `TaskCard.tsx` — compact card for lists & dashboard
- `TaskQuickCreateForm.tsx` — title, assignee, link-to (autocomplete), due
- `TaskStatusPill.tsx` — re-use design-system StatusPill spec
- `TaskOverlayBar.tsx` — absolutely-positioned bar in schedule grid spanning anchor→today
- `TasksCard.tsx` — replaces the dashboard placeholder
- `HandoverPanel.tsx` — "Since you were last here at X" panel
- `SignOutHandoffDialog.tsx` — write a handover note before logout

### Reuse from design-system

- `StatusPill` (open/in_progress/done) — extend `design-system/specs/StatusPill.md`
- `CountdownBadge` (calm/soon/urgent based on age) — already aligned
- `Button`, `IconButton`, `Badge`, `Section` — straight reuse

---

## 3b. Escape valves on the schedule grid (OQ-10)

To keep the drag-across bars readable at 70+ properties, the schedule renders three filter controls in the header (all default ON in v1):

1. **Open tasks only** — hides closed-task bars (frozen gray). On by default.
2. **Mine only** — restricts bars + cell badges to `assigneeId === me`. Off by default for ops staff; on by default for cleaners viewing schedule (if/when granted).
3. **Group by city** — collapses property rows into city clusters that expand on click. Useful at 30+ properties; toggle persists per user via `localStorage`.

These are pure client-side filters layered on the same query (no extra Convex round-trips for toggling).

## 4. Schedule grid: drag-across rendering

The schedule is a CSS grid of `(properties × days)` cells. To render a task that spans multiple days:

1. Server returns tasks for the visible date window.
2. Client computes for each open task: `startCol = max(anchorDate, windowStart)`, `endCol = closedAt ?? today`.
3. Render an absolutely-positioned `TaskOverlayBar` inside the property's row, with `grid-column: startCol / span (endCol - startCol + 1)`.
4. The cell still owns its `+` button and count, but the bar overlays beneath the cell content with a low-opacity fill + colored left border, so cell content stays readable.
5. Color tier from `CountdownBadge` tokens — **calm `<2d` → soon `<5d` → urgent `≥5d`, capped at urgent (no further escalation, no pulsing).** Decided OQ-10.

A "show closed" toggle re-renders frozen bars in muted gray.

---

## 5. Dashboard integration

Replace the placeholder `Tasks` card in `dashboard-client.tsx` with a real `<TasksCard />`:

```
┌── Tasks ──────────────────── New ───┐
│ My open: 7  ·  Handover: 3 new      │
│                                     │
│ • Airbnb claim — Berlin   urgent    │
│ • Trash in — Houston      soon      │
│ • Confirm dishwasher fix  calm      │
│                                     │
│ View all  ·  Hand off shift         │
└─────────────────────────────────────┘
```

- Top line: counts (links to `/tasks?assignee=me&status=open` and `/ops-handover`).
- Body: top 3 open tasks sorted by `(priority desc, age desc)`.
- Footer: link to full list + "Hand off shift" CTA (opens dialog).

---

## 6. Handover flow

**Outgoing user (Sign out & hand off):**
1. Click footer button → `<SignOutHandoffDialog />`.
2. Dialog auto-suggests recent activity (tasks I touched in last 8h, open critical incidents).
3. User adds free-text note, can pin specific tasks.
4. Submit → `handoverNotes.create` + `userPresence.signOut`.
5. Optional: actually log out, or stay signed in — independent.

**Incoming user (next dashboard load):**
1. `userPresence.touch()` runs.
2. `<HandoverPanel />` queries:
   - Latest unacknowledged `handoverNote` where `authorId !== me`.
   - `getActivityForUser(me, since=lastSeenAt)` → tasks newly assigned, status changes on tasks I own, new high/critical incidents on properties I'm watching.
3. Panel renders a digest. User clicks **Acknowledge** → `handoverNotes.acknowledge`.

---

## 7. Search integration

Tasks added to global search index (existing search infra in `src/components/search/` if present, else build):
- Index fields: `title`, `description` (truncated), `assignee.name`, `property.name`.
- Result row links to `/tasks/[taskId]`.
- Filter chip: "Tasks" alongside Properties/Jobs/Incidents.

---

## 8. Performance & scale considerations

- At 70 properties × 30 days = 2,100 cells. Drag-across rendering must batch by property row, not per-cell, to keep DOM under control.
- Convex query for the schedule range should fetch *all open tasks intersecting the window* in one shot, not per-cell. Use the `by_anchor_status` index with a date range filter.
- Recurring-task materialization runs in a Convex cron — keep the 14-day window so we don't generate 365 rows × N properties × M templates upfront.
- Handover digest is computed on read (no denormalized table) — paginate if `lastSeenAt` is very old (>7d, fall back to "you've been gone a while" summary mode).

---

## 9. Mobile (cleaner app) — *now in scope for M1*

Per OQ-2 decision (2026-04-28), cleaners are assignable. The cleaners-app gets a **My Tasks** screen in M1:

- Route: `app/(cleaner)/tasks/index.tsx` (list) + `app/(cleaner)/tasks/[taskId].tsx` (detail)
- Query: `opsTasks.queries.listForAssignee(me, { status })` — same Convex function the web uses
- Mutations cleaners can call: `setStatus`, `addComment`, `attachPhoto` (gated by `requireTaskActor`)
- Mutations cleaners cannot call: `create`, `assign`, `update`, `delete`
- Push notification on assignment via existing Expo push pipeline (reuse the channel used for `cleaningJobs` assignment, but a distinct event type so users can mute one without the other)
- Reuses cleaner-side design tokens (purple primary, Spectral/Montserrat) and existing `StatusPill` / `CountdownBadge` specs in `design-system/specs/`

Cleaners only see tasks assigned to them — the schedule grid and `/tasks` list remain ops-only on web.

---

## 9b. Voice dictation for handover (R12)

**Web** (`SignOutHandoffDialog`):
- Use the browser **Web Speech API** (`window.SpeechRecognition || window.webkitSpeechRecognition`).
- `recognition.continuous = true; recognition.interimResults = true; recognition.lang = locale === "es" ? "es-US" : "en-US";`
- Mic button toggles a session; interim transcripts append to the textarea live; user can edit anytime; final transcript is what's saved.
- No audio leaves the device; we only persist the resulting text. Set `bodySource = "dictated"` if mic was used and text wasn't subsequently typed; `"mixed"` if both.
- Feature-detect on mount; hide button if unavailable (Firefox desktop, some embedded WebViews).

**Mobile (cleaner app & ops on phones):**
- Use `expo-speech-recognition` (or platform-native if it lags Expo SDK 54). Same UX: tap to start, tap to stop, transcript fills textarea.
- Microphone permission requested on first use only.

**Privacy & safety:**
- No audio storage, no third-party API.
- Add to PRIVACY notes: handover dictation runs on-device; transcript text is stored as part of the handover note like any typed body.

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Schedule grid becomes a wall of red bars at 70+ properties | Default open-tasks-only filter, mine-only filter, city/cluster grouping (R10, OQ-10) |
| Tasks duplicate `cleaningJobs` checklist functionality | Keep the line by *purpose*: jobs = scheduled cleanings with SLA/photos/payable; tasks = lighter ad-hoc errands (refill orders/pickups). Both can be assigned to the same cleaner on the same day; UI labels them distinctly. |
| Cleaners confused between "jobs" and "tasks" in mobile UI | Mobile bottom-nav keeps **Jobs** (existing) and adds **Tasks** as a separate tab — never mixed in one list. Distinct iconography (clipboard for tasks, broom for jobs). |
| Recurring task explosion | 14-day rolling window + idempotency key `(templateId, anchorDate, propertyId)` |
| Free-text handover notes go ignored | Force acknowledgement before dismissing the dashboard panel |
| Schema affects mobile cleaner app | None of the new tables are read by mobile in v1; safe to add without coordinated deploy |
