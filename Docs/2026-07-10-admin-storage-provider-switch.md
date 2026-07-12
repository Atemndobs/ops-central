# Admin-selectable storage provider (B2 ↔ MinIO)

**Task:** `task/storage-provider-switch` · **Date:** 2026-07-10 · **Schema impact:** backward-compatible (one optional field)

## Why

Photos/videos are served from **Backblaze B2** via presigned S3 URLs. On 2026-07-10 every
thumbnail in the cleaner "Active Job" wizard broke because B2 returned
`403 AccessDenied — download bandwidth or transaction (Class B) cap exceeded`. Metadata
(photo counts) still rendered because that comes from Convex; only the B2 downloads failed.

Today storage is **hardcoded to B2** on both paths:
- Write: `requireExternalStorageConfig()` → `requireB2Config()` (`convex/lib/externalStorage.ts`)
- Read: `createExternalReadUrl()` → `requireB2Config()` (ignores the row's stored `provider`)

MinIO is already wired, but only as the 7-day cold-archive tier (`archive-photos-to-minio`
cron via `copyObjectBetweenStores`). There is no runtime switch.

## What this ships

An admin-configurable **active storage provider** on the existing `appSettings` singleton,
plus a **provider-aware read path** so each object is signed against the store it actually
lives in. New uploads honor the admin's choice; existing B2 objects keep reading from B2.

### Backend
1. **Schema** — add `appSettings.storageProvider?: "b2" | "minio"` (optional; absent ⇒ `"b2"`).
2. **`externalStorage.ts`** — `StorageProvider` type + `getConfigForProviderOrNull()` /
   `requireConfigForProvider()`; `createExternalReadUrl` / `createExternalUploadUrl` accept an
   optional `provider` (defaults to `"b2"` for legacy rows).
3. **`appSettings.ts`** — `resolveStorageProvider(ctx)` helper, `listStorageProviders` +
   `getStorageProvider` queries, `setStorageProvider` admin mutation (rejects switching to a
   provider whose env vars aren't configured — mirrors `setVoiceProvider`).
4. **`photoUrls.ts`** — pass `photo.provider` (and `posterProvider`) into the read URL.
5. **`files/mutations.ts`** — `getExternalUploadUrl` selects config from the active setting and
   records the true provider on the row; pass `provider` into the post-upload read URL.
6. **`cleaningJobs/queries.ts`** — pass the snapshot photo's `provider` into the read URL.

### Frontend
7. **`StorageProviderCard`** (mirrors `AIProviderCard`) + a Settings section; i18n keys in
   `en.json` / `es.json`.

## Correctness invariant

The read path signs each object with **its own** `photos.provider`, never a global default.
This is the load-bearing fix: it lets B2 history and future MinIO objects coexist.

## ⚠️ Operational prerequisite (out of scope for this PR)

MinIO lives at `192.168.0.114:9000` (LAN/Tailscale only). Presigned MinIO URLs are
**unreachable from cleaners' phones on cellular**. Do **not** flip the switch to MinIO until
it is publicly reachable (Cloudflare Tunnel / reverse proxy / Tailscale Funnel). The switch
defaults to B2 and `setStorageProvider` refuses MinIO when `MINIO_*` env vars are unset.

## Immediate un-break (separate, operator action)

Raise the Backblaze **Caps & Alerts** daily download-bandwidth + Class-B/C transaction caps
(needs a payment method on file). Optional follow-up: CDN in front of B2 (free egress via the
Bandwidth Alliance) to stop repeat views counting as fresh downloads.
