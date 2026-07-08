# Property Rooms from Hospitable — Diagnosis & Fix Plan

**Date:** 2026-04-21
**Status:** Draft — plan only, no code changes yet
**Scope:** opscentral-admin + jna-cleaners-app
**Owner:** TBD

---

## Problem

Every place in the apps that needs to show a property's rooms is currently "guessing" — rendering a hardcoded `["Living Room", "Kitchen", "Bedroom", "Bathroom"]` list regardless of the real property. A 4-bedroom house and a studio look identical in the cleaner UI. Free-text room inputs let cleaners type arbitrary strings that don't match the property's real rooms.

The source of truth should be the Hospitable API (`/properties` + `/properties/{id}` → `room_details`), and every UI that references rooms should read the synced `property.rooms` array.

---

## What Already Exists (Good News)

The backend plumbing is mostly in place:

- **Schema field:** `properties.rooms: { name: string, type: string }[]` — [`convex/schema.ts:119-123`](../../convex/schema.ts)
- **Sync action:** `syncPropertyDetails` fetches `/properties` + `/properties/{id}`, parses `room_details`, numbers duplicates ("Bedroom 1", "Bedroom 2"), and writes to `properties.rooms` — [`convex/hospitable/actions.ts:650`](../../convex/hospitable/actions.ts)
- **Cron:** `syncPropertyDetails` runs on a scheduled cron — [`convex/crons.ts:16`](../../convex/crons.ts)
- **Mutation:** `updatePropertyDetails` writes rooms to the property doc — [`convex/hospitable/mutations.ts:275-311`](../../convex/hospitable/mutations.ts)
- **Mobile uses it when available:** `report-incident.tsx` already prefers `property.rooms` when populated — [`jna-cleaners-app/app/(cleaner)/report-incident.tsx:123-147`](../../../jna-cleaners-app/app/(cleaner)/report-incident.tsx)

**Conclusion:** This is mostly a *consumption* problem, not a sync problem. The UI ignores `property.rooms` and falls back to hardcoded defaults.

---

## Root-Cause Map — 6 Places That Need Work

### 1. Cleaner active-job screen hardcodes 4 rooms
[`src/components/cleaner/cleaner-active-job-client.tsx:41-46`](../../src/components/cleaner/cleaner-active-job-client.tsx) defines:

```typescript
const DEFAULT_ROOM_KEYS = [
  "cleaner.rooms.livingRoom",
  "cleaner.rooms.kitchen",
  "cleaner.rooms.bedroom",
  "cleaner.rooms.bathroom",
] as const;
```

`buildRoomList()` only *adds* rooms discovered in already-uploaded evidence on top of these defaults — it never reads `property.rooms`.

**Fix:** Include `property.rooms` in the job-detail query; drive the rendered room list from `property.rooms.map(r => r.name)`. Remove `DEFAULT_ROOM_KEYS`. Fall back only if `property.rooms` is empty (with a visible warning + resync CTA for admins).

### 2. Mobile incident report synthesizes a fallback
[`jna-cleaners-app/app/(cleaner)/report-incident.tsx:123-147`](../../../jna-cleaners-app/app/(cleaner)/report-incident.tsx) — `getAvailableRooms()` uses `property.rooms` when present, but on empty synthesizes `["Living Room", "Kitchen", "Bedroom×N", "Bathroom×N", "Laundry"]` from bedroom/bathroom counts.

**Fix:** Delete the synthesis fallback. If `property.rooms` is empty, show a disabled state with "Rooms not synced — contact admin" rather than invented names.

### 3. Admin property detail has no rooms UI
[`src/components/properties/property-detail.tsx`](../../src/components/properties/property-detail.tsx) shows only "X Beds · Y Baths". No way to view the synced `rooms` array, verify it, or trigger a resync.

**Fix:** Add a "Rooms" section that lists `property.rooms` with their types, plus a "Resync from Hospitable" button that calls a new single-property sync action.

### 4. Free-text `roomName` on photos and incidents
[`convex/schema.ts:684`](../../convex/schema.ts) — `photos.roomName: v.string()` and line 752 `incidents.roomName: v.optional(v.string())` accept any string. Typos like "livingroom" vs "Living Room" create orphan rows that can't be joined back to `property.rooms`.

**Fix:** Keep field type, but add server-side validation in the photo-upload and incident-create mutations: reject (or normalize) `roomName` values that don't match `property.rooms[].name` (case-insensitive match). Replace any remaining text inputs in web forms with `<Select>` components sourced from `property.rooms`.

### 5. No single-property resync endpoint
`syncPropertyDetails` only runs for *all* properties in a loop. When an admin fixes a room list in Hospitable, they have to wait for the next cron tick or trigger a full resync.

**Fix:** Extract the loop-body into `syncSinglePropertyDetails({ propertyId })` internalAction, exposed via a public action for admins.

### 6. We don't actually know if `rooms` is populated
Because the UI masks the problem with fallbacks, we can't tell whether the cron has been writing `rooms` successfully. Possible real issues: missing `HOSPITABLE_API_KEY` in prod, `room_details` shape changed, silent cron failure.

**Fix:** Step 0 of execution — check the Convex dashboard. If `rooms` is empty across properties, investigate cron logs and env vars before any UI work.

---

## Execution Plan (Ordered)

| #   | Task                                                                                            | Where                                                                              | Risk                                  |
| --- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------- |
| 1   | Verify `property.rooms` is populated in Convex. Run `syncPropertyDetails` manually if empty.    | Convex dashboard / CLI                                                             | None                                  |
| 2   | Add `syncSinglePropertyDetails` action + admin-facing wrapper.                                  | `convex/hospitable/actions.ts`                                                     | Low                                   |
| 3   | Add Rooms section + "Resync" button on admin property detail page.                              | `src/components/properties/property-detail.tsx`                                    | Low                                   |
| 4   | Gut `DEFAULT_ROOM_KEYS`; drive cleaner active-job room list from `property.rooms`.              | `src/components/cleaner/cleaner-active-job-client.tsx`                             | **Medium** — touches cleaner golden path |
| 5   | Remove synthesis fallback in mobile `report-incident.tsx`; show resync prompt when empty.       | `jna-cleaners-app/app/(cleaner)/report-incident.tsx`                               | Low                                   |
| 6   | Replace any remaining free-text `roomName` inputs with dropdowns sourced from `property.rooms`. | Grep for `roomName` in `src/components/**` and `jna-cleaners-app/`                 | Low                                   |
| 7   | Server-side `roomName` validation in photo-upload + incident-create mutations.                  | `convex/cleaningJobs/mutations.ts`, incident mutations                             | Medium — could reject legacy rows     |
| 8   | Optional: one-shot data normalization for existing free-text rows (or leave as historical).     | script or migration                                                                | Low                                   |

---

## Cross-App Coordination

- Steps 1–4, 6 (web), 7: **opscentral-admin**
- Step 5: **jna-cleaners-app**
- Schema does **not** need to change — only stricter writes.
- After any Convex changes in opscentral-admin, mirror to cleaners via `npm run sync:convex-backend` (per CLAUDE.md).

---

## Non-Goals / Open Questions

- **Manual rooms authoring:** Should admins be able to *add* rooms beyond what Hospitable returns (e.g. a "Garage" the owner forgot to list)? Current plan keeps Hospitable as sole source of truth; admin UI is read + resync. **Decision needed before step 3.**
- **Renaming rooms:** Admins might want friendlier names ("Master Bedroom" instead of "Bedroom 1"). Out of scope for now — would require an override table.
- **Legacy `roomName` rows** with typos: leave as historical, or normalize? Recommend leaving.

---

## Success Criteria

1. Opening a property's cleaner active-job shows exactly the rooms Hospitable knows about — no more, no less.
2. Admin property detail page shows the synced rooms and can trigger a one-property resync.
3. Every form that captures a room reference is a dropdown, not a text field.
4. No new photo or incident can be written with a `roomName` that isn't in `property.rooms`.
