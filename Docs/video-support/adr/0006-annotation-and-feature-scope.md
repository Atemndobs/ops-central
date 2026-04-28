# ADR 0006: Feature parity scope — what videos do NOT inherit from photos in v1

## Status

Proposed — 2026-04-26

## Context

Photos in this codebase support a long tail of features: per-photo annotations (circle / freehand / marker, see `components/AnnotatedPhoto.tsx` and `src/components/jobs/job-photos-review-client.tsx`), submission snapshots in `jobSubmissions.photoSnapshot`, archival to cold storage, source attribution (`app | whatsapp | manual`), notes, room-name normalisation.

A naive interpretation of "make video work everywhere photos work" would have us build all of the above for video on day one. Most of those features either (a) make no sense for video (annotations on a moving frame), or (b) are mechanical to add later once the core path lands.

This ADR draws the line so the scope review in code is short.

## Decision

### Inherited as-is (v1)

| Feature | Why |
|---|---|
| `cleaningJobId`, `roomName`, `type` (before/after/incident) | Same workflow slot as photos |
| `source` (`app | whatsapp | manual`) | Same provenance model |
| `notes`, `uploadedBy`, `uploadedAt` | Free metadata |
| Submission snapshot in `jobSubmissions.photoSnapshot` | Captures `mediaKind` so the immutable approval record knows it's video |
| Archival via `photoArchives` and `photoStorageAggregate` | Bytes are bytes — same lifecycle |
| Auth rules (every read/write goes through the same Convex helpers) | Inherited |
| Permission to delete (`deleteJobPhoto`) | Generalised to delete media; deletes both primary object and poster |
| Resolver fallback chain (Convex → external) | Extended to take `kind: "primary" | "poster"` |

### Explicitly deferred

| Feature | Why deferred |
|---|---|
| **Per-frame annotations** (circle / freehand) | Drawing on a moving image is a real product question, not a quick port. Reviewers can still leave a `notes` comment in v1. Revisit when we have evidence of demand. |
| **Time-coded comments** ("at 0:14, fridge handle is loose") | Same as above. v1 reviewers comment on the whole clip, not a timestamp. |
| **Inline trim/edit** | Cleaners can re-record. Trim is nice-to-have, not blocking. |
| **GIF preview generation** | Poster JPEG is enough for v1. |
| **Bulk download as ZIP** for reports | Already a gap for photos, not a video-specific blocker. |
| **Search by transcript** (Whisper / Speech-to-Text on incident audio) | Significant new infra; revisit only if incident triage volume justifies it. |
| ~~**Per-tenant video quota (minutes/month)**~~ | **Resolved 2026-04-26 — quota IS in scope.** Promoted to its own decision: see [ADR-0008](0008-per-tenant-video-quota.md). Hard gate before SaaS rollout (Phase 6). |

### Cleaner-PWA vs admin-web parity

- **Cleaner PWA** (`/cleaner` routes in opscentral-admin) and **mobile cleaner app**: full capture + playback parity. Cleaners are the primary creators.
- **Admin web** (`opscentral-admin`): playback everywhere, capture only on property gallery / checkpoint reference (admin uploads are uncommon).
- **Owner-facing public report**: playback only, no controls beyond play/pause/scrub/full-screen.

## Consequences

**Positive:**
- Phase 1 ships without re-implementing the annotation overlay system, which is the most complex piece of the photo stack.
- Each deferred item is a clean follow-up phase, not a refactor.

**Costs:**
- Reviewers used to circling problems on photos will need to write text comments for video. We should call this out in release notes and watch for confusion.

## Alternatives considered

### Build annotation parity in v1

Rejected. The annotation overlay (`AnnotatedPhoto.tsx`) is currently keyed to a still image's pixel coordinates. Generalising to a `(x, y, t)` triple plus a render layer that survives playback is a multi-week project with its own design questions. Not v1.

### Defer audio capture to keep cleaners' workflow private

Rejected as a default. **Decided 2026-04-26: audio is recorded by default**, with a clear mute toggle in the capture UI surfaced before recording starts (not buried in settings). Privacy is real but evidence-with-audio is materially more useful (running water, a barking dog, a guest conversation, a hissing AC unit). The toggle handles the privacy case for cleaners who need it. Cleaner onboarding material must call out the audio default explicitly so cleaners are not surprised.

## Out of scope

- Anything not in the "Inherited" or "Deferred" tables above is genuinely out of scope (live streaming, multi-camera, etc.).
