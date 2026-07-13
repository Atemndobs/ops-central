# Schedule — Hospitable-style Occupancy (reservations) view

**Date:** 2026-07-13
**Branch:** `task/schedule-occupancy`
**Goal:** Add a Hospitable-style reservation timeline to the existing schedule, as an **Occupancy | Tasks** toggle. Reservations render as horizontal bars spanning check-in→check-out per property, with guest name, channel icon, occupancy pip, and guest photo. **No pricing row** (we have no per-night pricing data).

## Scope (confirmed with user)
- MVP reservation bars **+ real guest photos** (from Hospitable payload). No pricing row.
- Lives as a toggle on `/schedule` (like Hospitable's Occupancy | Tasks), reusing the current grid.

## What already exists (reused, not rebuilt)
- `schedule-client.tsx`: property-rows × date-columns CSS grid (`scheduleGridTemplateColumns` = sticky prop col + `repeat(rangeDays.length, dayColPx)`), week/month modes, Today marker, drag-to-pan, horizontal scroll.
- `stays` table (`convex/schema.ts`): `propertyId`, `guestName`, `checkInAt`, `checkOutAt`, `numberOfGuests`, `platform`, `totalAmount`, `cancelledAt`.
- `properties.imageUrl` thumbnails; initials-avatar pattern (`AssignedCleanerBadge`, `PropertyInitials`).
- Hospitable webhook + cron already populate `stays`.

## Work items
1. **Schema (additive, safe):** add `stays.guestPhotoUrl` (optional string).
2. **Ingest:** `convex/hospitable/actions.ts normalizeReservation` — extract guest avatar from payload (`guest.picture` / `guest.avatar` / `guest.photo_url`, verified against a real `hospitableWebhookEvents.rawPayload`); pass through `upsertSingleReservation`. Backfill action from archived rawPayloads (best-effort).
3. **Backend query:** `convex/stays/queries.ts getInDateRange({from,to})` — stays overlapping the window (`checkInAt < to && checkOutAt > from`) across scoped properties. **Fail-closed scoped** via `getCallerJobScopeForListing` (managers only see their company's properties, mirroring the jobs query). Return stay + `propertyId`, `guestName`, `guestPhotoUrl`, `numberOfGuests`, `platform`, `checkInAt/Out`, `cancelledAt`.
4. **Frontend toggle:** `boardMode: "tasks" | "occupancy"` state + Occupancy|Tasks segmented control (top bar, next to the existing controls).
5. **Frontend bars:** in occupancy mode, render each property row with an absolutely-positioned bar layer: `left = daysFromRangeStart(checkInAt) * dayColPx`, `width = nights * dayColPx`, clipped to the visible range. Bar shows guest photo (fallback initials) + name + channel icon; occupancy pip = `numberOfGuests`. Cancelled stays dimmed/hidden.
6. **Channel icon map:** `platform` string → Airbnb / VRBO / Booking / Direct glyph.

## Deploy
Schema + query are additive → deploy Convex from the **main** session after merge (`npx convex deploy` with prod key), then Vercel auto-builds. Guest-photo backfill run once post-deploy.

## Deferred (not this PR)
- Per-night pricing row (needs Hospitable pricing-API sync + new table).
- "Add booking" / "Preview dynamic pricing" / "Layers" controls from Hospitable.
