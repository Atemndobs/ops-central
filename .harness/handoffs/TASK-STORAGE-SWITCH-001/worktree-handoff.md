# Worktree Handoff

## Task
TASK-STORAGE-SWITCH-001

## Type
implementation

## Branch
task/storage-provider-switch

## Worktree
~/sites/opscentral-admin-storage-switch

## Base
origin/main @ c13c4a1

## Status
ready-for-integration

## What changed
Admin-selectable object-storage backend (B2 ↔ MinIO) on the `appSettings` singleton,
plus a **provider-aware read path** so every object is signed against the store it
actually lives in (previously reads were hardcoded to B2 and ignored `photos.provider`).

Backend (`convex/`):
- `schema.ts` — `appSettings.storageProvider?: "b2" | "minio"` (optional; absent ⇒ b2).
- `lib/externalStorage.ts` — `StorageProvider` type, `DEFAULT_STORAGE_PROVIDER`,
  `normalizeStorageProvider()`, `getConfigForProviderOrNull()`, `requireConfigForProvider()`;
  `createExternalReadUrl` / `createExternalUploadUrl` now take an optional `provider`
  (defaults to b2 for legacy rows).
- `appSettings.ts` — `resolveStorageProvider(ctx)` helper; `listStorageProviders` +
  `getStorageProvider` queries; `setStorageProvider` admin mutation (refuses a backend
  whose env vars aren't configured — mirrors `ai/settings.setVoiceProvider`).
- `lib/photoUrls.ts` — pass `photo.provider` / `photo.posterProvider`; gates now check the
  object's own provider config, not B2-only.
- `files/mutations.ts` — `getExternalUploadUrl` selects config from the active setting and
  records the true provider on the row; post-upload read passes `provider`.
- `cleaningJobs/queries.ts` — snapshot-photo read passes the object's provider.

Frontend (`src/`):
- `components/settings/storage-provider-card.tsx` — new admin picker (mirrors `AIProviderCard`),
  with a MinIO reachability warning banner.
- `components/settings/settings-page-client.tsx` — new "Photo & video storage" section under
  Settings → Integrations.

Docs:
- `Docs/2026-07-10-admin-storage-provider-switch.md`.

## What main should test
1. `npx convex deploy` FIRST (regenerates `_generated` for the new `appSettings.*` fns +
   `storageProvider` field) — see Convex impact below.
2. THEN `npm run build` — must be green. (Building before deploy WILL fail: the frontend
   references `api.appSettings.listStorageProviders/getStorageProvider/setStorageProvider`
   and `storageProvider`, which don't exist in the committed `_generated` yet.)
3. Settings → Integrations → "Photo & video storage": B2 shows **Active**; MinIO shows
   **Not configured** iff `MINIO_*` env vars are unset on the deployment (radio disabled).
4. Existing B2 photos still load everywhere (dashboard, job detail, cleaner active job) —
   the read path is unchanged for b2 rows (`provider` defaults to b2).
5. Do NOT switch the active provider to MinIO in prod (see risks).

## Schema impact
backward-compatible — one optional field (`appSettings.storageProvider`), no index, no
backfill. Qualifies for the combined schema+feature exception. Rollback = `git revert`.

## Convex impact
deploy-required — new `appSettings.{listStorageProviders,getStorageProvider,setStorageProvider}`
functions + `storageProvider` schema field must be deployed to `lovable-oriole-182`, then
mirrored to cleaners (`npm run sync:convex-backend`). **Deploy before `npm run build`.**

## Known risks
- **MinIO is LAN/Tailscale-only (`192.168.0.114:9000`).** Presigned MinIO URLs are NOT
  loadable by cleaners' phones on cellular. Switching the active provider to MinIO before
  MinIO is publicly reachable (Cloudflare Tunnel / reverse proxy / Tailscale Funnel) will
  break field photo display. The switch defaults to b2 and `setStorageProvider` refuses
  MinIO when `MINIO_*` is unset — but if MINIO_* IS set (used today for the 7-day archive),
  the guard passes, so treat flipping to MinIO as gated on public reachability, not just env.
- Reads are now provider-aware; b2 rows are unaffected (default). No MinIO-served rows exist
  yet, so the new read branch is exercised only after a deliberate switch + fresh upload.

## Rollback plan
- `git revert <merge sha>` + redeploy. No data cleanup: `storageProvider` is optional and
  only ever set by an explicit admin action; existing photo rows are untouched.

## Related (not in this PR)
- Immediate B2 cap un-break: raise Backblaze Caps & Alerts (operator/billing action).
- Future: CDN in front of B2 (free egress via Bandwidth Alliance) to cut Class-B reads.
