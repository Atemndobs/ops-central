# Decisions Log

One-line snapshot of every resolved question, with the date and the alternative we passed on. Use this when revisiting trade-offs later — the *why* lives in `open-questions.md`.

| ID | Date | Decision | Passed on |
|---|---|---|---|
| OQ-1 | 2026-04-28 | Tasks may have no property (global ops tasks). | Forcing every task to attach to a property. |
| OQ-2 | 2026-04-28 | Cleaners ARE assignable to tasks; mobile gets "My Tasks" in M1. | Ops-only assignment. |
| OQ-3 | 2026-04-28 | Status set stays minimal (`open → in_progress → done`); drag-across bar locked as v1. | Adding `blocked` / `cancelled` upfront. |
| OQ-4 | 2026-04-28 | No mandatory closure evidence in v1; `closedBy` + `closedAt` always recorded. | Forcing comment/photo on close. |
| OQ-5 | 2026-04-28 | In-app toast for ops + Expo push for cleaners on M1; email digest in M2; no SMS. | Push for everyone / email-everywhere / SMS. |
| OQ-6 | 2026-04-28 | No formal shift schedules; use `userPresence.lastSeenAt`. | Defining shift windows per user. |
| OQ-7 | 2026-04-28 | v1 handover: free-form text **with mic dictation**; v2 (M2.5): minimum checklist. | Pure auto-digest with no free text. |
| OQ-8 | 2026-04-28 | Stacked-section dashboard card, no tabs. | Tabbed (My / Team / Handover). |
| OQ-9 | 2026-04-28 | Recurrence: 14-day window, hourly idempotent cron. | 30-day window or daily cron. |
| OQ-10 | 2026-04-28 | Color tiers calm/soon/urgent, capped at urgent (no pulse); v1 ships open-tasks-only + mine-only + city-collapse filters default-on. | Fading bars over time / unlimited escalation. |
| OQ-11 | 2026-04-28 | Store user-authored text as-is; record `authoredLocale`; no auto-translation. | Auto-translate at write time. |

## Schema additions traced from these decisions

- `opsTasks.assigneeRole` *(OQ-2)*
- `opsTasks.authoredLocale` *(OQ-11)*
- `opsTasks.closedBy` *(OQ-4)*
- `handoverNotes.bodySource` *(OQ-7 / R12)*
- `handoverNotes.checklistResponses` reserved *(OQ-7 / R13, populated in M2.5)*
- `handoverNotes.authoredLocale` *(OQ-11)*
- `handoverChecklistConfig` reserved table *(OQ-7 / R13, ships in M2.5)*
- `userPresence.lastSeenAt` / `lastSignedOutAt` *(OQ-6)*

## Plan deltas traced from these decisions

- M1 grew ~2–3 days for cleaner mobile screen *(OQ-2)*.
- M2 grew ~1 day for voice dictation *(OQ-7 / R12)*.
- New M2.5 milestone (~2 days) for handover checklist *(OQ-7 / R13)*.
- M3 unchanged.
