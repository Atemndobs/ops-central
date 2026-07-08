# ADR 0004: Client-side transcode and poster generation are mandatory before upload

## Status

Proposed — 2026-04-26

## Context

[ADR-0003](0003-format-codec-and-size-limits.md) commits us to H.264/AAC/MP4 with a 25 MB ceiling. Mobile capture sources do not produce that natively:

- iOS captures HEVC (`.mov`) by default since iOS 11.
- Android captures H.264 but at device-default bitrate, often 12–20 Mbps for 1080p.
- Picker-supplied videos can be arbitrary format/duration.

A poster image (single-frame JPEG) is needed for: gallery thumbnails (mobile + web), conversation message previews, owner reports, and any UI that shows media without immediately playing it. Generating posters server-side requires ffmpeg and is not feasible on Convex.

## Decision

### On mobile (`jna-cleaners-app`)

- Use **`react-native-compressor`** (`Video.compress`) for transcode. It wraps `AVAssetExportSession` (iOS) and `MediaCodec` (Android). Output is H.264/AAC/MP4 at our target preset.
- Use **`expo-video-thumbnails`** (`getThumbnailAsync({ time: 0 })`) to extract poster JPEG.
- Compression and poster extraction happen **before** the upload ticket is requested. UI shows a "preparing video…" state.
- If transcode fails (rare — bad codec on origin), the capture is rejected with a clear error and the original file is discarded. We do not upload originals as a fallback.

### On web (`opscentral-admin`)

- Web admin uploads (rare path, mostly used for property gallery / checkpoint reference) accept user-selected files via a standard `<input type="file" accept="video/mp4">`.
- The web client validates `duration`, `width × height`, and `size` using a hidden `<video>` element with `metadata` preload.
- Web does **not** transcode in v1. Files outside the constraints are rejected with a "please re-record at 720p / convert to MP4" message. (Browser-side transcode via WASM ffmpeg is feasible but costly and deferred.)
- Poster is grabbed from the client via `<canvas>.drawImage(video, …)` at `currentTime = 0` and uploaded as a sibling JPEG.

### Storage layout

For an external upload ticket of a video, the backend issues **two** signed PUT URLs in one ticket response:

```
{
  videoUploadUrl: "...",
  videoObjectKey: "videos/<jobId>/<uuid>.mp4",
  posterUploadUrl: "...",
  posterObjectKey: "videos/<jobId>/<uuid>.poster.jpg",
  expiresAt: ...
}
```

The client uploads both, then calls `completeExternalUpload()` with both `objectKey`s. Atomicity: if the poster PUT fails, the entire upload is abandoned and neither object is registered. The `photos` row is only inserted after both objects are confirmed in the bucket.

### Poster on the `photos` row

`photos.posterStorageId` is unused for video (videos never go to `_storage`); `photos.posterObjectKey`, `posterBucket`, `posterProvider` carry the external poster reference. `resolvePhotoAccessUrl()` gains a `kind: "primary" | "poster"` argument.

## Consequences

**Positive:**
- Every video has a poster — no "black square" placeholders in galleries.
- Bytes-per-upload is predictable; cellular cost stays bounded.
- The same compressed format ships to every consumer; no per-device-quirks branch in playback code.

**Costs:**
- Mobile capture-to-upload time grows by ~3–8 s for transcode. We surface this in the UI ("preparing video…" with progress).
- New mobile dependency: `react-native-compressor`. Vetted: MIT, ~1 MB native, used by Bluesky and others.
- Web admin can't recover from a misformatted upload without the user re-encoding. Acceptable — admin web video uploads are rare.

## Alternatives considered

### Server-side transcode in a Convex action

Rejected. Convex actions cannot run ffmpeg. Would require an external worker (Lambda / Fly.io); too much new infra for v1.

### WASM ffmpeg in the browser for web admin

Deferred. ffmpeg.wasm works but adds ~30 MB of WASM and is slow on consumer laptops. Revisit if web admin video upload becomes common.

### Skip poster, generate at render time via `<video preload="metadata">`

Rejected for owner-facing reports (they're often viewed offline / printed) and for performance (every gallery thumbnail would force a metadata fetch).

## Out of scope

- Per-frame thumbnail strips for scrubbing.
- Animated GIF poster previews.
- Server-side re-encoding of WhatsApp inbound (see [ADR-0003](0003-format-codec-and-size-limits.md)).
