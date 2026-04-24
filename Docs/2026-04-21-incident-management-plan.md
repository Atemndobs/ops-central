# Incident Management — Implementation Plan

**Date:** 2026-04-21
**Branch:** feature branch off `main` (per feedback rule — not on current `codex/cleaner-rollout-quick-wins-saas-plan`)
**Scope:** Admin list + resolve UI (web) and cleaner "My Incidents" history (mobile). Backend schema already exists.

---

## Problem

Cleaners can report incidents but:
- **Admins / property_ops / managers have no UI** to list, filter, or resolve them. `src/app/(dashboard)/work-orders/page.tsx` is a placeholder shell.
- **Cleaners cannot see their own reported incidents** or their status. `app/(cleaner)/history.tsx` only shows completed jobs.

Backend is ready: `incidents` table + `createIncident` mutation exist. Missing: list query, status-update mutation, and two UI surfaces.

---

## Goals

1. Admin / ops / manager can **list, filter, open, and resolve** incidents in the web app.
2. Cleaner can **see a history of their reported incidents**, with status, job link, and resolution notes.
3. Zero schema changes — backend table already covers everything needed.

---

## Non-Goals

- No push notifications when status changes (future).
- No incident→work-order promotion workflow (future — separate plan).
- No bulk operations.
- No analytics dashboards beyond what already exists in reports.

---

## Architecture Overview

```
┌─────────────────────────┐        ┌──────────────────────────┐
│  Admin Web              │        │  Cleaner Mobile          │
│  /incidents (NEW)       │        │  /incidents/history (NEW)│
│   - list + filters      │        │   - my reports           │
│   - detail + resolve    │        │   - status chip          │
└──────────┬──────────────┘        └────────────┬─────────────┘
           │                                    │
           └────────────────┬───────────────────┘
                            │
                 ┌──────────┴───────────┐
                 │  Convex (shared)     │
                 │  incidents/          │
                 │   queries.ts  (+new) │
                 │   mutations.ts(+new) │
                 └──────────────────────┘
```

---

## Backend Work (opscentral-admin/convex)

### B1 — Add queries

**File:** [convex/incidents/queries.ts](../convex/incidents/queries.ts) (extend, do not replace `getIncidentsForJob`)

Add:
- `listIncidents({ status?, severity?, propertyId?, reporterId?, limit?, cursor? })` — for admin list. Uses `requireRole(ctx, ["admin", "property_ops", "manager"])`. Paginated via `ctx.db.query("incidents").withIndex("by_status"|"by_property_and_created_at").paginate()`. Returns reporter + property name + first photo URL for list rendering.
- `getIncidentById(id)` — role-gated (admin/ops/manager OR reporter). Full detail incl. photos + resolver info.
- `listMyIncidents({ limit?, cursor? })` — any authenticated user. Filters `reportedBy == currentUser._id`. Indexed scan via `by_created_at` with in-handler filter, or add `by_reporter_and_created_at` index if volume warrants. Returns property name, job link, status, photos.

**Index decision:** Add `.index("by_reporter_and_created_at", ["reportedBy", "createdAt"])` to `incidents` in schema.ts — small addition, big perf win for cleaner history. This is the only schema edit.

### B2 — Add status-update mutation

**File:** [convex/incidents/mutations.ts](../convex/incidents/mutations.ts) (extend)

Add:
- `updateIncidentStatus({ incidentId, status, resolutionNotes? })` — role-gated `["admin", "property_ops", "manager"]`. Transitions among `open → in_progress → resolved|wont_fix`. When status becomes `resolved` or `wont_fix`, sets `resolvedAt = now`, `resolvedBy = user._id`. Always bumps `updatedAt`.

### B3 — Deploy
- `cd opscentral-admin && npx convex dev` to push.
- After push: `cd jna-cleaners-app && npm run sync:convex-backend` to mirror generated types.

---

## Admin Web Work (opscentral-admin)

### W1 — Replace work-orders shell with real incidents page

Decision: **rename** route `work-orders` → `incidents` (more accurate; work-orders is a future feature). Keep `/work-orders` as a redirect for one release.

**New files:**
- `src/app/(dashboard)/incidents/page.tsx` — Server Component, role gate via existing pattern (check neighbouring dashboard pages).
- `src/app/(dashboard)/incidents/incidents-page-client.tsx` — `'use client'`, uses `useQuery(api.incidents.queries.listIncidents, ...)`.
- `src/app/(dashboard)/incidents/[incidentId]/page.tsx` — detail + resolve drawer/form.
- `src/components/incidents/incident-list-table.tsx` — shadcn/ui Table; columns: title, property, severity chip, status chip, reporter, created, actions.
- `src/components/incidents/incident-filter-bar.tsx` — status / severity / property / date dropdowns.
- `src/components/incidents/incident-status-chip.tsx` — shared status pill (also reused by cleaner web view).
- `src/components/incidents/incident-resolve-form.tsx` — shadcn Form; status select + resolutionNotes textarea → calls `updateIncidentStatus` mutation.

**Sidebar:** update `src/components/layout/sidebar.tsx` (or equivalent) — rename `Work Orders` entry to `Incidents`, keep icon.

### W2 — Redirect old route

`src/app/(dashboard)/work-orders/page.tsx` → `redirect('/incidents')` so nothing 404s.

---

## Cleaner Mobile Work (jna-cleaners-app)

### M1 — "My Incidents" screen

**New files:**
- `app/(cleaner)/incidents/history.tsx` — FlatList of `listMyIncidents` results. Empty state: "No incidents reported yet." Pull-to-refresh.
- `app/(cleaner)/incidents/[incidentId].tsx` — detail view. Shows title, description, photos (using existing `<PhotoGrid />`), status chip, job link (navigates to job detail), resolution notes if resolved.
- `components/incidents/IncidentStatusChip.tsx` — matches web colors (open=gray, in_progress=blue, resolved=green, wont_fix=muted-red).
- `components/incidents/IncidentListItem.tsx` — row with title, property, status chip, relative date.

### M2 — Wire entry points

- Add a tab or card on [app/(cleaner)/index.tsx](../../jna-cleaners-app/app/(cleaner)/index.tsx) linking to `/incidents/history`.
- Add "My Incidents" to the cleaner navigation drawer/tabs (follow existing `history.tsx` pattern).
- In [app/(cleaner)/report-incident.tsx](../../jna-cleaners-app/app/(cleaner)/report-incident.tsx), after successful submit, navigate to `/incidents/history` (or show toast with link).

### M3 — i18n

Add strings to `messages/en.json` and `messages/es.json` under `cleaner.incidents.history.*` (title, empty state, status labels, resolved-at label). Required by the bilingual feedback rule.

---

## Parallelization Plan

**Critical path:** Backend (B1+B2) must land first, because both UI tracks depend on the new query/mutation types in `_generated/api`.

### Wave 1 — Backend (sequential, single agent, ~30 min)
Must finish before Wave 2 starts.

| Task | Owner | Files |
|------|-------|-------|
| B1 schema index + queries | Agent A | `convex/schema.ts`, `convex/incidents/queries.ts` |
| B2 mutation | Agent A | `convex/incidents/mutations.ts` |
| B3 deploy + sync types | Agent A | run `npx convex dev`, `npm run sync:convex-backend` |

**Gate:** confirm `api.incidents.queries.listIncidents` and `api.incidents.mutations.updateIncidentStatus` show up in the generated types for both apps.

### Wave 2 — Fully parallel (three agents)

Once types are generated, these three tracks touch disjoint files and can run simultaneously:

| Track | Agent | Scope | Files touched |
|-------|-------|-------|----------------|
| **T1: Admin web — list + filters** | Agent B | W1 minus resolve form | `src/app/(dashboard)/incidents/page.tsx`, `incidents-page-client.tsx`, `components/incidents/incident-list-table.tsx`, `incident-filter-bar.tsx`, `incident-status-chip.tsx`, sidebar rename, `work-orders/page.tsx` redirect |
| **T2: Admin web — detail + resolve** | Agent C | W1 detail subset | `src/app/(dashboard)/incidents/[incidentId]/page.tsx`, `components/incidents/incident-resolve-form.tsx` |
| **T3: Cleaner mobile — history + detail** | Agent D | M1 + M2 + M3 | `app/(cleaner)/incidents/history.tsx`, `app/(cleaner)/incidents/[incidentId].tsx`, `components/incidents/IncidentStatusChip.tsx`, `IncidentListItem.tsx`, i18n strings, entry point wiring |

**Conflict risk:** T1 and T2 both create files under `components/incidents/`. `incident-status-chip.tsx` is created by T1 and consumed by T2 — have T1 commit first, or extract the chip as a tiny upfront task (T0, 5 min) before splitting.

### Wave 3 — Verification (single agent, after T1/T2/T3 merge)

| Task | Files |
|------|-------|
| Manual QA against dev server (admin): create incident → filter → resolve → verify audit fields | — |
| Manual QA against Expo client (cleaner): report → see in history → open detail → see status update after admin resolves | — |
| Playwright smoke test for admin list + resolve (optional) | new `e2e/incidents.spec.ts` |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Schema edit (new index) needs coordination with cleaners app | Index-only add is non-breaking; sync step in B3 covers it |
| Role gate regression (cleaner accidentally sees admin list) | `listIncidents` uses `requireRole`; cleaner app must call `listMyIncidents` only |
| Cleaner can't mark own incident as "resolved" — is that right? | Yes. Only admin/ops/manager resolves. Document in UI. |
| Renaming work-orders route breaks bookmarks | Keep redirect in place for a release |
| Large photo payloads in list | List query returns only first-photo URL; full gallery lazy-loaded on detail |

---

## Definition of Done

- [ ] `listIncidents`, `getIncidentById`, `listMyIncidents`, `updateIncidentStatus` deployed to `dev:usable-anaconda-394`, types mirrored to cleaners app.
- [ ] `/incidents` route renders filtered list for admin/ops/manager; `/work-orders` redirects.
- [ ] Resolve form updates status + writes `resolvedAt/By/Notes`; list refreshes reactively.
- [ ] Cleaner app has "My Incidents" tab showing reporter's history with status chips and job links.
- [ ] i18n keys present in en + es.
- [ ] Manual QA passes end-to-end: cleaner reports → admin resolves → cleaner sees resolved status live.

---

## File Map (quick reference)

**Backend (opscentral-admin/convex):**
- `schema.ts` (+1 index)
- `incidents/queries.ts` (+3 exports)
- `incidents/mutations.ts` (+1 export)

**Admin web (opscentral-admin/src):**
- `app/(dashboard)/incidents/page.tsx` (new)
- `app/(dashboard)/incidents/incidents-page-client.tsx` (new)
- `app/(dashboard)/incidents/[incidentId]/page.tsx` (new)
- `app/(dashboard)/work-orders/page.tsx` (→ redirect)
- `components/incidents/*` (5 new files)
- `components/layout/sidebar.tsx` (rename entry)

**Cleaner mobile (jna-cleaners-app):**
- `app/(cleaner)/incidents/history.tsx` (new)
- `app/(cleaner)/incidents/[incidentId].tsx` (new)
- `components/incidents/*` (2 new files)
- `messages/en.json`, `messages/es.json` (+ keys)
- `app/(cleaner)/index.tsx` (entry link)
- `app/(cleaner)/report-incident.tsx` (post-submit nav)
