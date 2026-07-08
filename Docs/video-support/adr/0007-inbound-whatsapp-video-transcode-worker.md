# ADR 0007: External worker to transcode inbound WhatsApp/SMS video

## Status

**Deferred — 2026-04-26.** This ADR captures a design that will be implemented as a **separate follow-up effort**, not as part of the v1 video-support rollout. The decision (and rejected alternatives) are preserved here so the next contributor doesn't re-litigate them.

**v1 behaviour instead:** inbound WhatsApp/SMS video is accepted as-is and the display layer falls back to "download to view" when the browser can't play natively. See [ADR-0003 § Inbound](0003-format-codec-and-size-limits.md#inbound-phase-4--accept-as-is-in-v1).

**Trigger to revive this ADR:** customer complaints about unplayable inbound video after Phase 6 soak, OR a tenant whose workflow depends on inbound owner-shared video reports.

When revived, this work becomes its own implementation plan (its own README, IMPLEMENTATION-PLAN, and possibly additional ADRs for AWS infra-as-code choices). The design below is the starting point but should be re-validated — costs, AWS service options, and Convex capabilities may have moved by then.

---

## Context (preserved from original design)

The motivation for **eventually** transcoding inbound video is that normalising to canonical H.264/AAC/MP4 + faststart would let us:

- a single `<video>`/`<VideoView>` codepath plays every clip on every device,
- the same duration / byte budget applies to inbound and outbound,
- owner-facing reports don't randomly fail to play because a guest cleaner sent an HEVC `.mov`.

WhatsApp delivers in 3GPP, MOV, or HEVC depending on the sender's device. Our cleaner-side mobile transcode (`react-native-compressor`) doesn't apply — these clips never touched our app. Convex actions cannot run ffmpeg. We therefore need an external transcode worker.

## Decision (deferred — recorded for future reference)

When this work is revived, stand up a small external transcode worker that ffmpeg-normalises inbound video and writes the canonical version + poster back into the same B2/MinIO bucket.

### Worker placement

**AWS Lambda with the `ffmpeg-static` layer** is the v1 target. Rationale:

- We already use AWS for adjacent infra and have IAM in place.
- A 60-second clip transcodes well under Lambda's 15-min ceiling and 10 GB ephemeral storage.
- Pay-per-invocation matches the bursty inbound pattern — most of the day there's no traffic.
- No always-on compute to babysit.

(Fly.io / Render were considered as alternatives. Either is viable; AWS Lambda wins on familiarity.)

### Trigger

Convex action `convex/conversations/onInboundVideo.ts` runs when an inbound conversation message has `attachmentKind === "video"` and the MIME isn't already canonical. The action:

1. Inserts the original into `conversationMessageAttachments` with `processingState: "pending_transcode"` and the original object key.
2. Enqueues an SQS message containing `{ attachmentId, sourceProvider, sourceBucket, sourceObjectKey }`.
3. Returns immediately — the message renders with a "processing video…" placeholder in the meantime.

The Lambda consumer:

1. Downloads the source from B2/MinIO via signed GET.
2. Runs `ffmpeg -i source -c:v libx264 -profile:v main -preset veryfast -crf 23 -maxrate 5M -bufsize 10M -c:a aac -b:a 128k -movflags +faststart -t 60 -vf "scale='min(1280,iw)':-2" out.mp4` (clips at 60 s; downscales above 720p; preserves aspect ratio).
3. Extracts poster: `ffmpeg -i out.mp4 -ss 0 -vframes 1 -q:v 3 poster.jpg`.
4. Uploads both to the bucket as `videos/inbound/<attachmentId>/<uuid>.mp4` + `…poster.jpg`.
5. Calls a Convex internal mutation `internal.conversations.completeInboundTranscode({ attachmentId, ... })` to update the row to canonical metadata and `processingState: "ready"`.
6. On hard failure (3 retries via SQS DLQ), updates `processingState: "failed"` with reason; UI falls back to "download original" link.

### Original retention

The original (pre-transcode) object stays in `videos/inbound/<attachmentId>/original.<ext>` for **30 days** as a fallback (in case transcode mangled something a human needs to verify). A nightly cleanup deletes originals older than 30 days where `processingState === "ready"`.

### Schema change

`conversationMessageAttachments` gains:

```ts
processingState: v.optional(v.union(
  v.literal("ready"),
  v.literal("pending_transcode"),
  v.literal("transcoding"),
  v.literal("failed"),
)),
processingError: v.optional(v.string()),
originalObjectKey: v.optional(v.string()), // kept for 30 days
originalMimeType: v.optional(v.string()),
```

`processingState === undefined` means "ready" for backward compatibility (existing photo/audio/document attachments).

### Cost envelope

- Lambda: 30s clip transcodes in ~5–10 s on 1 vCPU at 1769 MB. Cost per inbound: ~$0.0002.
- SQS: negligible.
- Extra storage: original (max 30 days) + canonical + poster. Per inbound video, ~50 MB-day average → ~$0.0003/month per clip.

At 1,000 inbound videos/month: < $1 transcode + < $1 storage. Trivial.

## Consequences

**Positive:**
- One playback codepath end-to-end, regardless of source.
- Inbound video respects the same 60 s / 25 MB constraints as outbound — predictable cost and bandwidth.
- The transcode failure mode is observable (`processingState: "failed"`) and recoverable (re-enqueue).

**Costs:**
- New AWS infra: Lambda function + SQS queue + IAM role. Documented as Infra-as-Code (see [IMPLEMENTATION-PLAN.md](../IMPLEMENTATION-PLAN.md) Phase 4b).
- New deploy pipeline step. Acceptable — small.
- Async UX: inbound videos show a "processing…" state for ~10 s after arrival. Reactive Convex query auto-updates when ready.

## Alternatives considered

### Accept inbound as-is and "download to view" for unplayable cases

This was the original ADR-0003 position. Rejected on review because owner-facing reports cannot tolerate "click to download" on evidence — they need inline playback.

### Convex action with WASM ffmpeg

Rejected. ffmpeg.wasm in a Convex action would blow the 64 MB action bundle limit and run ~10× slower than native ffmpeg.

### Mux / Cloudflare Stream / Bunny.net managed transcode

Rejected for v1. Vendor cost and lock-in for what is a simple one-shot transcode. Revisit if we ever need adaptive streaming (which we explicitly don't — see [ADR-0005](0005-playback-progressive-no-streaming.md)).

### Always-on transcode service (Fly.io worker)

Rejected. Bursty traffic doesn't justify a baseline cost. Lambda's cold-start overhead (~1 s) is invisible relative to a 5–10 s transcode.

## Out of scope

- Transcoding **outbound** video (already handled client-side by `react-native-compressor`).
- Transcoding inbound **audio** to a normalised codec (separate concern; audio plays everywhere already).
- AI captioning / transcription (revisit as a separate feature).
