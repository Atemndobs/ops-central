# ADR 0005: Progressive HTTP playback only; no HLS/DASH in v1

## Status

Proposed — 2026-04-26

## Context

Once a video is in B2/MinIO as `faststart`-flagged H.264/MP4 ([ADR-0003](0003-format-codec-and-size-limits.md)), two playback strategies are open:

1. **Progressive HTTP / range requests** — the player issues `GET` with `Range:` headers; B2/MinIO supports this natively; playback starts as soon as the moov atom + first GOP arrives.
2. **Adaptive streaming (HLS or DASH)** — segment + manifest, multi-bitrate ladder. Better for long-form on flaky networks; needs server-side segmentation.

Our target clip is ≤ 60 s and ≤ 25 MB ([ADR-0003](0003-format-codec-and-size-limits.md)). Adaptive streaming buys us little at that length.

## Decision

### Web (`opscentral-admin`)

- Native `<video controls preload="metadata" poster={posterUrl}>` element.
- `src` is the resolved B2/MinIO signed URL with a 5-minute expiry.
- A thin `<VideoAttachment>` component wraps `<video>` and handles signed-URL refresh on `error`.
- The lightbox in `job-photos-review-client.tsx` gains a video case that mounts `<video>` instead of `<img>`.

### Mobile (`jna-cleaners-app`)

- Use **`expo-video`** (SDK 54+ recommended replacement for deprecated `expo-av Video`).
- `useVideoPlayer(uri)` for player state; `<VideoView player={player} />` for rendering.
- Poster is shown via the standard `<Image source={posterUri}>` overlay until first play tap, to avoid auto-loading bytes on every gallery scroll.
- Lazy load: galleries render poster-only; the player mounts on tap.

### Signed URLs

- Read URLs are signed with **5-minute expiry** (matches existing photo behavior in `convex/lib/photoUrls.ts`).
- For owner-facing public report links (Phase 5), URLs are signed with longer expiry (24 h) and the URL is regenerated server-side on each report render.

### What we do NOT build in v1

- No HLS / DASH transmuxing.
- No DRM.
- No watermarking.
- No "watch progress" tracking (resume from where you left off).
- No bandwidth-aware bitrate selection — single rendition only.

## Consequences

**Positive:**
- Zero new server infrastructure. B2/MinIO + native players do all the work.
- Mobile and web share the same URL contract (`resolvePhotoAccessUrl(photoId, kind: "primary" | "poster")`).
- Time-to-first-frame is excellent at our file sizes (~200–500 ms on LTE).

**Costs:**
- A cleaner on a 1-bar 3G connection in a parking garage may experience buffering. Acceptable for a one-time evidence playback; not acceptable if we ever ship long-form content.
- We pay full file bandwidth on every play. At 25 MB × N plays per video, this matters at scale and is the main reason we capped duration tightly.

## Alternatives considered

### HLS via Mux / CloudFront MediaConvert

Rejected for v1. Adds a vendor + cost; saves nothing at our duration cap. Revisit if either (a) we raise the duration cap above 5 minutes, or (b) a tenant complains about playback on flaky networks.

### `expo-av Video` instead of `expo-video`

Rejected. `expo-av` Video API is deprecated as of SDK 54; new module is `expo-video`. Going straight to the supported API avoids a forced migration in 2026.

### Background prefetch in galleries

Rejected. Burns mobile data without consent. We may revisit a "preload first 1 s" behavior once we have telemetry on actual play rates.

## Out of scope

- Picture-in-picture playback.
- AirPlay / Chromecast.
- Captions (no subtitle track captured).
