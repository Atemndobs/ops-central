# ADR 0002: Videos must use external B2/MinIO storage; legacy Convex `_storage` is photo-only

## Status

Proposed — 2026-04-26

## Context

The platform currently supports two upload paths, documented in [2026-04-04-photo-upload-architecture-index.md](../../2026-04-04-photo-upload-architecture-index.md):

1. **Legacy** — direct upload to Convex `_storage` via `generateUploadUrl()` (`convex/files/mutations.ts:66`).
2. **External** — presigned PUT to B2/MinIO via `getExternalUploadUrl()` / `completeExternalUpload()` (`convex/files/mutations.ts:107` / `:167`).

Convex `_storage` is convenient but expensive at scale (see [Photo_Storage_Cost_Analysis.md](../../Photo_Storage_Cost_Analysis.md)) and has a 20 MB-per-file practical ceiling that bites at the very low end of usable video. B2/MinIO has been in production for photos for ~3 weeks.

A 30-second cleaner walkthrough at 720p30 H.264 ~5 Mbps lands at ~18 MB. Allowing it on Convex storage would (a) silently push us over the per-file ceiling for any longer clip, (b) blow Convex bandwidth budget, and (c) bypass the cost telemetry in `photoStorageAggregate` because that aggregate is B2-scoped.

## Decision

Videos **MUST** be uploaded through the external path. The backend mutations enforce this:

- `getExternalUploadUrl()` accepts a new arg `mediaKind: "image" | "video"`. When `"video"`, the function rejects unless the configured external provider is healthy (`provider !== "convex"`).
- `completeExternalUpload()` writes `mediaKind: "video"` and the video metadata fields. It does NOT accept Convex `storageId` for video rows.
- `uploadJobPhoto()` (legacy Convex-storage path, `convex/files/mutations.ts:74`) keeps working for images and **rejects** when called with video MIME types. It returns a stable error code `VIDEO_REQUIRES_EXTERNAL_UPLOAD` so clients can fall through.

If B2/MinIO is unavailable (`provider === "convex"` from the resolver), video capture UI is disabled with a clear message, not silently downgraded.

## Consequences

**Positive:**
- One storage codepath for video → simpler ops, predictable cost, accurate telemetry.
- `photoStorageAggregate` remains the single source of truth for billable storage (now including video bytes — no schema change needed since it tracks `byteSize`).
- Range requests for progressive playback work natively against B2/MinIO; Convex `_storage` does not expose range semantics reliably.

**Costs:**
- Tenants without B2/MinIO configured cannot record video. Acceptable: external storage is the documented production path, and the SaaS rollout requires it anyway.
- One extra branch in the upload service — handled cleanly by the existing `mode: "legacy" | "external"` switch in `services/photoUploadService.ts`.

## Alternatives considered

### Allow videos in Convex `_storage` for small files

Rejected. The "small file" boundary is arbitrary and migrates poorly. A 25 MB cap would force re-recording for clips that compress slightly worse than expected.

### Server-side proxy through Convex action to B2

Rejected. Doubles bandwidth cost and adds a Convex action invocation per video. Direct presigned PUT is the documented and tested path.

### Per-tenant choice

Rejected as premature. Revisit if a customer needs an air-gapped MinIO and we want to support both.

## Out of scope

- Per-tenant retention policies on video. Inherited from existing photo archival ([Convex-to-MinIO_PhotoArchivingPlan.md](../../Convex-to-MinIO_PhotoArchivingPlan.md)).
- Different bucket per media kind. Same bucket, distinguish via `objectKey` prefix `videos/` vs `photos/`.
