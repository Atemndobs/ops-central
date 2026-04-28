# ADR 0003: H.264 / AAC in MP4, capped at 60 s and 25 MB post-compression

## Status

Proposed — 2026-04-26

## Context

Cleaner-originated video has three reasonable formats on the capture side:

- **H.264 / AAC in MP4** — universal: every browser since 2014, every iOS, every Android Chrome. Hardware-decoded everywhere we ship.
- **HEVC (H.265) / AAC in MP4** — smaller files, but Android Chrome still has inconsistent playback and Safari requires MP4 with `hvc1` brand specifically.
- **AV1** — best compression, but no encoder on most user devices and patchy decode in Safari.

WhatsApp inbound is usually H.264/AAC in MP4 already; some Samsung devices still ship 3GPP for short clips.

Owner-facing playback runs in a browser `<video>` element. Cleaner-side capture runs through `expo-camera` / `expo-image-picker` on iOS and Android.

A 30 s clip at 720p30, H.264 ~5 Mbps + AAC 128 kbps ≈ 18 MB. 60 s ≈ 36 MB raw, ~20–25 MB after target-bitrate transcode.

## Decision

### Format

The canonical stored format is **H.264 baseline/main profile, AAC-LC, MP4 container, `faststart` flag set** (moov atom at front, required for HTTP range / progressive playback).

### Constraints

| Constraint | Default | Rationale |
|---|---|---|
| Max duration | 60 s | Cleaning evidence is short; 60 s covers a full-room pan |
| Max post-compression size | 25 MB | Safe for cellular upload; predictable cost |
| Max pre-compression size | 200 MB | Hard ceiling to refuse 4K originals before transcode |
| Target resolution | 720p (1280×720) | Sufficient for evidence; halves bytes vs 1080p |
| Target frame rate | 30 fps | Above 30 wastes bytes for static scenes |
| Target bitrate | 4–6 Mbps video, 128 kbps audio | Tuned for 720p30 H.264 |
| Audio | Recorded by default, mutable in capture UI | See open question in [README](../README.md) |

All constraints are enforced **client-side before upload**. The backend re-validates: `completeExternalUpload()` rejects on `byteSize > maxBytes` or unknown `mimeType` outside the allowlist `[video/mp4]`.

The constraints are exposed via Convex feature-flag config (`featureFlags`/`platformConfig`) so we can tighten or relax without redeploy. Defaults above ship in code as fallbacks.

### Inbound (Phase 4) — accept as-is in v1

WhatsApp / SMS inbound video can arrive in 3GPP, MOV, or HEVC. **In v1 these are accepted as-is** into `conversationMessageAttachments` with their original MIME type and object key. The display layer:

- Renders inline via the standard `<video>` / `<VideoView>` player when the browser/OS can play the format natively.
- Falls back to a **"download to view"** link when native playback fails (most commonly: iPhone HEVC `.mov` viewed on Android Chrome, or 3GPP from older Android devices viewed on Safari).

We do **not** server-side transcode in v1. The original Phase 4b plan to ship an AWS Lambda + ffmpeg worker has been deferred — see [ADR-0007](0007-inbound-whatsapp-video-transcode-worker.md) (status: **Deferred**) for the design that's been preserved for a future follow-up effort.

This is intentional v1 behaviour, not a temporary state. If "download to view" turns into a real customer-facing complaint after Phase 6 soak, that's the trigger to schedule the deferred transcode worker.

## Consequences

**Positive:**
- Predictable byte budget per cleaner per shift.
- One playback codepath — every player can decode the canonical format.
- `faststart` + range-request-capable storage = videos play before the file finishes downloading.

**Costs:**
- 60 s cap will frustrate someone eventually. We accept it; longer clips can be raised behind a feature flag for specific tenants.
- HEVC originals from iPhone (default since iOS 11) must be transcoded on-device to H.264, which costs battery and ~3–8 s of capture-to-upload latency. Documented in [ADR-0004](0004-client-side-compression-and-poster.md).

## Alternatives considered

### Accept HEVC end-to-end

Rejected. Saves ~30 % on bytes but breaks Android Chrome playback for ~25 % of cleaner devices.

### No client-side transcode, store original

Rejected. iPhone HEVC originals don't play in Android Chrome; raw 1080p60 originals blow the byte budget by 5×.

### Generate adaptive HLS server-side

Deferred. Worth revisiting only if we hit playback complaints on slow networks. See [ADR-0005](0005-playback-progressive-no-streaming.md).

## Out of scope

- Subtitles / captions.
- 360° / VR video.
- Slow-motion (high-fps) capture.
