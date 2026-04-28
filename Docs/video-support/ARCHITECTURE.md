# Video Support — Architecture

This document describes the end-to-end shape of the video feature: schema, upload flow, playback flow, and how each consumer surface plugs in. It assumes you have read the [README](README.md) and the six [ADRs](adr/).

## Layered view

```
┌──────────────────────────────────────────────────────────────────────┐
│  Capture                                                             │
│  ┌────────────────────┐         ┌────────────────────────────────┐   │
│  │ Mobile             │         │ Web admin                       │   │
│  │ expo-camera /      │         │ <input type="file">            │   │
│  │ expo-image-picker  │         │ + <video> metadata probe       │   │
│  │   ↓                │         │   ↓                            │   │
│  │ react-native-      │         │ (no transcode in v1)           │   │
│  │ compressor         │         │                                │   │
│  │   ↓                │         │ canvas poster grab             │   │
│  │ expo-video-        │         │                                │   │
│  │ thumbnails (poster)│         │                                │   │
│  └─────────┬──────────┘         └────────────┬───────────────────┘   │
│            │                                 │                       │
└────────────┼─────────────────────────────────┼───────────────────────┘
             │                                 │
             ▼                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Convex (opscentral-admin/convex)                                    │
│                                                                      │
│  files/mutations.ts                                                  │
│   ├── getExternalUploadUrl({ mediaKind: "video", contentType, ... })│
│   │     returns { videoUploadUrl, videoObjectKey,                   │
│   │              posterUploadUrl, posterObjectKey, expiresAt }       │
│   ├── completeExternalUpload({ ...mediaMetadata, mediaKind })       │
│   │     inserts photos row (with mediaKind, durationMs, w/h, poster)│
│   │     updates photoStorageAggregate                               │
│   └── deleteJobPhoto(photoId)                                        │
│         deletes primary + poster from external bucket                │
│                                                                      │
│  lib/photoUrls.ts                                                    │
│   └── resolvePhotoAccessUrl(photoId, kind: "primary" | "poster")     │
└─────────────────────────────────┬────────────────────────────────────┘
                                  │
                                  ▼
                        ┌───────────────────┐
                        │  B2 / MinIO       │
                        │  bucket layout:   │
                        │   videos/<jobId>/ │
                        │     <uuid>.mp4    │
                        │     <uuid>.poster │
                        │             .jpg  │
                        │   photos/<jobId>/ │
                        │     <uuid>.jpg    │
                        └─────────┬─────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Playback                                                            │
│  Mobile: expo-video <VideoView>                                      │
│  Web:    native <video controls preload="metadata" poster=...>      │
└──────────────────────────────────────────────────────────────────────┘
```

## Schema deltas

See [ADR-0001](adr/0001-extend-photos-table-with-media-kind.md) for the rationale. Concrete diff to `convex/schema.ts`:

```ts
const photos = defineTable({
  cleaningJobId: v.id("cleaningJobs"),
  storageId: v.optional(v.id("_storage")),
  provider: v.optional(v.string()),
  bucket: v.optional(v.string()),
  objectKey: v.optional(v.string()),
  objectVersion: v.optional(v.string()),
  byteSize: v.optional(v.number()),
  archivedTier: v.optional(v.string()),
  archivedAt: v.optional(v.number()),

  roomName: v.string(),
  type: v.union(
    v.literal("before"),
    v.literal("after"),
    v.literal("incident"),
  ),
  source: v.union(
    v.literal("app"),
    v.literal("whatsapp"),
    v.literal("manual"),
  ),

  // NEW — media discriminator
  mediaKind: v.optional(
    v.union(v.literal("image"), v.literal("video")),
  ), // undefined === "image" for backward compat

  // NEW — video-only fields
  durationMs: v.optional(v.number()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  posterStorageId: v.optional(v.id("_storage")),
  posterObjectKey: v.optional(v.string()),
  posterBucket: v.optional(v.string()),
  posterProvider: v.optional(v.string()),

  annotations: v.optional(v.any()),
  notes: v.optional(v.string()),
  uploadedBy: v.optional(v.id("users")),
  uploadedAt: v.number(),
})
  .index("by_job", ["cleaningJobId"])
  .index("by_job_room", ["cleaningJobId", "roomName"])
  .index("by_job_type", ["cleaningJobId", "type"])
  .index("by_job_kind", ["cleaningJobId", "mediaKind"])
  .index("by_uploaded_at", ["uploadedAt"]);

// conversationMessageAttachments — add "video" + same metadata fields
const conversationMessageAttachments = defineTable({
  // ...existing...
  attachmentKind: v.union(
    v.literal("image"),
    v.literal("document"),
    v.literal("audio"),
    v.literal("video"), // NEW
  ),
  // NEW — video-only
  videoDurationMs: v.optional(v.number()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  posterObjectKey: v.optional(v.string()),
  posterBucket: v.optional(v.string()),
  posterProvider: v.optional(v.string()),
  // ...existing...
});

// jobSubmissions.photoSnapshot — add mediaKind to each entry
photoSnapshot: v.optional(v.array(v.object({
  photoId: v.id("photos"),
  storageId: v.optional(v.id("_storage")),
  provider: v.optional(v.string()),
  bucket: v.optional(v.string()),
  objectKey: v.optional(v.string()),
  roomName: v.string(),
  type: v.union(v.literal("before"), v.literal("after"), v.literal("incident")),
  uploadedAt: v.number(),
  uploadedBy: v.optional(v.id("users")),
  mediaKind: v.optional(v.union(v.literal("image"), v.literal("video"))), // NEW
}))),
```

`propertyImages`, `jobCheckpointChecks.failPhotoStorageId`, `propertyCriticalCheckpoints.referenceStorageId` are touched in Phase 5; same discriminator pattern applies.

## Upload flow (mobile)

```
1. User taps "Record video" in incident report or job before/after panel
2. expo-camera/expo-image-picker captures original (HEVC on iOS, H.264 on Android)
3. PhotoCapture component routes to videoCaptureService:
     a. validate duration (≤60s) and original size (≤200MB) → reject early on overflow
     b. transcode via react-native-compressor:
        { compressionMethod: "manual",
          maxSize: 1280, bitrate: 4_500_000,
          minimumFileSizeForCompress: 0 }
        UI shows "preparing video…" with progress
     c. extract poster: expo-video-thumbnails.getThumbnailAsync(uri, { time: 0, quality: 0.8 })
4. videoCaptureService calls Convex:
     getExternalUploadUrl({
       mediaKind: "video",
       contentType: "video/mp4",
       posterContentType: "image/jpeg",
       cleaningJobId, roomName, type
     })
5. Two parallel PUTs:
     PUT videoUploadUrl   ← compressed mp4
     PUT posterUploadUrl  ← poster jpg
   Either failure → abort, no Convex write.
6. videoCaptureService calls Convex:
     completeExternalUpload({
       cleaningJobId, roomName, type,
       mediaKind: "video",
       provider, bucket, objectKey, objectVersion, byteSize,
       posterProvider, posterBucket, posterObjectKey,
       durationMs, width, height,
       mimeType: "video/mp4",
     })
7. Convex inserts photos row, updates photoStorageAggregate, returns photoId.
8. Mobile UI optimistically shows poster + play overlay; reactive query confirms.
```

## Upload flow (web admin)

Same backend mutations. Web client:

1. `<input type="file" accept="video/mp4">` → user picks a file.
2. Validate via hidden `<video preload="metadata">`: `duration`, `videoWidth`, `videoHeight`, `size`.
3. Reject if any constraint fails (no transcode in v1).
4. Grab poster: render to `<canvas>` at `currentTime = 0`, `toBlob('image/jpeg', 0.8)`.
5. Call `getExternalUploadUrl` + two PUTs + `completeExternalUpload`. Same as mobile.

## Read / playback flow

```
Component                       Hook                              Convex
─────────                       ────                              ──────
<MediaThumbnail photoId/>  →    useMedia(photoId)            →    photos.get(photoId)
                                useMediaUrl(photoId, "poster") →   files.resolveUrl(photoId, "poster")
                                                              →    signed B2 URL (5min)

(on tap)
<VideoPlayer photoId/>     →    useMediaUrl(photoId, "primary") →  files.resolveUrl(photoId, "primary")
                                mounts <video> / <VideoView>
                                URL refresh on `error` / 403
```

## URL resolver change

`convex/lib/photoUrls.ts`:

```ts
type UrlKind = "primary" | "poster";

export async function resolvePhotoAccessUrl(
  ctx: QueryCtx,
  photoId: Id<"photos">,
  kind: UrlKind = "primary",
): Promise<string | null> {
  const photo = await ctx.db.get(photoId);
  if (!photo) return null;

  if (kind === "poster") {
    if (photo.posterObjectKey && photo.posterProvider && photo.posterBucket) {
      return createExternalReadUrl({
        provider: photo.posterProvider,
        bucket: photo.posterBucket,
        objectKey: photo.posterObjectKey,
      });
    }
    if (photo.posterStorageId) return ctx.storage.getUrl(photo.posterStorageId);
    // For images, the primary IS the poster.
    if ((photo.mediaKind ?? "image") === "image") return resolveImagePrimary(photo);
    return null;
  }

  // primary
  return resolveImagePrimary(photo); // works for both image and video — same metadata fields
}
```

## Consumer surfaces

| Surface | File | Change |
|---|---|---|
| Cleaner mobile incident report | `app/(cleaner)/report-incident.tsx` | Add "Record video" button next to "Take photo"; wire to videoCaptureService |
| Cleaner PWA before/after | `src/app/(cleaner)/...` | Mirror mobile; same button, same service |
| Job photos review (admin) | `src/components/jobs/job-photos-review-client.tsx` | Lightbox branches on `mediaKind`; renders `<VideoPlayer>` for video; existing annotation tools hidden for video (see [ADR-0006](adr/0006-annotation-and-feature-scope.md)) |
| Approval workflow | `src/components/review/review-photos-review-client.tsx` | Same as job photos review |
| Conversation thread (web) | `src/components/conversations/conversation-thread.tsx` | Render `<VideoPlayer>` when `attachmentKind === "video"` |
| Conversation thread (mobile) | `components/MessageAttachment.tsx`, `ConversationThreadView.tsx` | Same |
| Property gallery | `src/components/properties/property-detail.tsx` | Phase 5 — extend gallery item type |
| Critical checkpoint reference | `src/components/properties/property-critical-checkpoints-panel.tsx` | Phase 5 — reference video as alternative to reference image |

## Storage / cost

- All video bytes (primary + poster) flow through B2/MinIO.
- `photoStorageAggregate.totalBytes` already sums every external upload's `byteSize` — videos contribute automatically once `completeExternalUpload` is updated to write `byteSize` for video (which it already does for photos).
- Per the [Photo_Storage_Cost_Analysis.md](../Photo_Storage_Cost_Analysis.md), B2 storage is $0.006/GB-month and egress is $0.01/GB. A typical 25 MB video stored a year and viewed 10 times costs ~$0.005 — negligible at fleet size.
- Cron `serviceUsage/b2Snapshot.ts` continues to read the aggregate; no change.

## Security & permissions

- No new auth surfaces. Every read/write reuses the existing photo helpers (`assertCanAccessJobPhoto`, etc.).
- Signed URLs default to 5-min expiry; report-link generation uses 24-h expiry server-rendered each access.
- Audio capture is on by default; the cleaner UI shows a mute toggle pre-record (see open question in [README](README.md)).

## Telemetry

Add events (PostHog):
- `video_capture_started`, `video_capture_completed`, `video_capture_failed`
- `video_transcode_duration_ms` (mobile)
- `video_upload_duration_ms`, `video_upload_failed`
- `video_play_started`, `video_play_completed`, `video_play_buffered`

Existing photo events get a `mediaKind` property so we can compare adoption.

## Failure modes & rollback

| Failure | Behaviour |
|---|---|
| Mobile transcode fails | Capture rejected with clear error; original discarded; nothing uploaded |
| Poster upload fails | Whole upload abandoned; primary object also discarded; no Convex row |
| Primary upload fails after poster succeeded | Poster object orphaned in bucket; nightly cleanup job sweeps poster objects with no `photos` row referencing them |
| `completeExternalUpload` fails after both uploads | Both objects orphaned; same nightly sweep |
| Playback URL 403 (expired) | Player `error` handler refetches via `useMediaUrl`; one transparent retry |
| B2 outage | Capture UI shows "video temporarily unavailable; please use a photo"; existing photo path unaffected |

Rollback: `mediaKind` is optional. Reverting the client to a video-blind build still reads/displays existing photos. Existing video rows would render as broken images in old clients, but no data is lost — re-deploying the new build restores playback.
