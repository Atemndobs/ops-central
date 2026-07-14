# Worktree Handoff

## Task
TASK-PROPERTIES-PAGE-BUGS-001

## Type
fix (bug fix — 3 parts)

## Branch
task/properties-page-bugs

## Worktree
~/sites/opscentral-admin-properties-bugs

## Base
origin/main @ fcf2869

## Status
ready-for-integration

## PR
https://github.com/Atemndobs/ops-central/pull/248

## Source
Read-only investigation handoff: `Docs/bugs/2026-07-12-admin-properties-page-issues.md`
(reporter: Jule, 2026-07-12). Trello: https://trello.com/c/wbe98LVi

## What changed
- `convex/properties/mutations.ts`
  - New `reconcilePropertyImages(ctx, propertyId, photoUrls, primaryUrl)` helper —
    full-replace of the property's `propertyImages` rows (order-preserving, blanks +
    dups dropped, primary flagged).
  - `create` + `update` accept `photoUrls: v.optional(v.array(v.string()))`.
    `photoUrls` is destructured OUT of the `update` patch spread (not a `properties`
    column) and reconciled separately. `create` reconciles after insert.
  - New `updateRooms` mutation (dedicated, `requireRole(["admin","property_ops"])`) —
    persists room order. NOT folded into `update` on purpose (see Known risks).
- `convex/properties/queries.ts` — `enrichProperties` now reads each property's
  `propertyImages` via `by_property_order` (bounded, cap 20) and returns an ordered
  `photoUrls[]`, falling back to the legacy single `imageUrl` when no gallery rows
  exist. `primaryPhotoUrl` unchanged (still `property.imageUrl`).
- `src/components/properties/property-form-modal.tsx`
  - (b) Shell `max-h-[90vh]` flex column; header + footer `shrink-0`; body
    `flex-1 overflow-y-auto`. Save button always reachable.
  - (a) Uploaded `photoUrls` render as a thumbnail grid: tap = set primary
    (ring + "Primary" badge), hover-X = remove.
- `src/components/properties/property-detail.tsx` — hero swaps to selected thumbnail;
  thumbnail strip under the hero when >1 image. `toMutationInput` sends `photoUrls`.
- `src/app/(dashboard)/properties/page.tsx` — `toMutationInput` sends `photoUrls`;
  "+N photos" badge on card / mobile-list / table thumbnails.
- `src/components/properties/property-rooms-panel.tsx` — up/down reorder controls per
  room row calling `updateRooms`; caption reworded to "order = cleaner photo sequence".

## What main should test
1. `npm run lint && npm run build` clean. (In worktree: lint exit 0, build exit 0,
   TypeScript passes. Build only fails without a local `.env.local` at the pre-existing
   `/delete-account` prerender step needing `NEXT_PUBLIC_CONVEX_URL` — unrelated.)
2. After deploy — upload 2+ photos in the edit modal → Save → detail page shows a
   thumbnail strip; clicking a thumbnail swaps the hero; list shows "+N photos".
3. Set a non-first photo as primary → Save → it is the cover everywhere.
4. Edit modal on a short viewport scrolls; Save button stays pinned.
5. Reorder rooms with up/down → order persists after reload.

## Schema impact
none — `propertyImages` table + `by_property` / `by_property_order` indexes already
exist and are already in the schema export. No new fields, no migration.

## Convex impact
deploy-required (changed fn bodies + one new export on an EXISTING module, so
`_generated/api.d.ts` resolves it via `typeof import(...)` — no api.ts regen / codegen
needed). Mirror to cleaners with `npm run sync:convex-backend`.

## Commands main should run
- npm run lint
- npm run build
- npx convex deploy   (owner path, from main checkout — pushes to lovable-oriole-182)
- (then) cd ../jna-cleaners-app && npm run sync:convex-backend

## Known risks
- low. `updateRooms` is deliberately separate from `update`: the generic `update`
  handler rebuilds a full patch object (`name: patch.name?.trim()` …), so a partial
  `{ id, rooms }` call through it would blank the REQUIRED `name`/`address` columns and
  fail schema validation. Do not "simplify" by merging them.
- `photoUrls` MUST stay destructured out of the update patch spread — it is not a
  `properties` column and would fail validation if spread in.
- Hospitable resync (`resyncPropertyDetails`) may overwrite manual room order — flagged
  in the original investigation, intentionally out of scope here.
- `enrichProperties` now does one extra bounded index read per property. Table is empty
  today (dead until this ships) and holds a handful of rows per property once populated;
  read stays off the hot path that PR #246 optimized.

## Not verified
Automated browser preview blocked by Clerk auth (no test credentials) AND the new query
fields aren't live until main deploys. Needs a human eyeball on `/properties` + a
property detail page post-deploy. After verifying, move the Trello card
(https://trello.com/c/wbe98LVi) to ✅ Fixed and update the bug log's Fix section.

## Rollback plan
- git revert the merge commit + redeploy. `propertyImages` rows written before rollback
  are harmless orphans (read only by these queries + `admin/queries.getPropertyById`);
  no schema/migration to unwind.
