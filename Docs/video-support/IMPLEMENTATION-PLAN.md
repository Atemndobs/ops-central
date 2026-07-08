# Video Support — Implementation Plan

Phased rollout. Each phase is mergeable independently, behind a feature flag (`feature.video.enabled`, `feature.video.surfaces.<surface>`). Cleaner-facing surfaces ship behind the existing tenant-scoped flag system in `docs/feature-flags/`.

> **Pre-flight reading for any contributor:**
> [README](README.md), [ARCHITECTURE.md](ARCHITECTURE.md), ADRs [0001–0006](adr/) and [0008](adr/0008-per-tenant-video-quota.md), and [2026-04-04-canonical-photo-model-adr.md](../2026-04-04-canonical-photo-model-adr.md). [ADR-0007](adr/0007-inbound-whatsapp-video-transcode-worker.md) is **deferred** and not in scope for this rollout.

### Phase order at a glance

| Phase | Title | Days | Gate before next |
|---|---|---|---|
| 0 | Foundation: schema + types + resolver | 1–2 | Both apps build |
| 1 | Backend upload mutations | 2–3 | Manual upload script works |
| 2 | Mobile capture (incident-only) | 3–5 | Cleaner records incident video |
| 3 | Web admin playback (incident) | 1–2 | Admin reviews video |
| 4a | Job before/after + outbound conversation video; inbound stored as-is | 3–5 | Full job evidence loop works |
| 4b | Per-tenant quota | 3–4 | **Hard gate** for SaaS rollout |
| 5 | Property gallery + checkpoint references | 2–3 | Reference videos work |
| 6 | Hardening + soak + general rollout | 14 | Flag default flipped to true |

**Out of scope for this rollout** (separate future effort): inbound WhatsApp/SMS video server-side transcoding. Design preserved in [ADR-0007](adr/0007-inbound-whatsapp-video-transcode-worker.md). Trigger to schedule: customer-facing complaints about unplayable inbound video.

## Phase 0 — Foundation (1–2 days)

**Goal:** Schema + types + URL resolver land. No user-visible change. Both apps still build and run.

### Tasks

- [ ] `convex/schema.ts`: add `mediaKind`, video-only fields, and `by_job_kind` index to `photos`. Add `"video"` literal + video metadata fields to `conversationMessageAttachments`. Add `mediaKind` to `jobSubmissions.photoSnapshot` element validator.
- [ ] `convex/_generated`: regenerate via `npx convex dev --once` (run from `opscentral-admin/`, never from `jna-cleaners-app/` per project CLAUDE.md).
- [ ] `convex/lib/photoUrls.ts`: extend `resolvePhotoAccessUrl` with `kind: "primary" | "poster"` arg. All existing call-sites stay correct (`kind` defaults to `"primary"`).
- [ ] `types/shared.ts` (mobile) + `src/types/media.ts` (web): add `MediaKind`, `Photo` extended with optional video fields, `VideoMetadata`.
- [ ] Mirror schema to mobile: `cd jna-cleaners-app && npm run sync:convex-backend`.
- [ ] Add feature flags: `feature.video.enabled` (default false), per-surface flags scaffolded.

### Exit criteria

- `npm run build` passes in both apps.
- `npx convex dev --once` succeeds.
- No existing photo behaviour changes (manually click through one job + one incident in dev).
- Schema diff reviewed against `2026-04-04-canonical-photo-model-adr.md` for compatibility.

### Risk

Low. No mutation behaviour change. The schema additions are all `optional`.

---

## Phase 1 — Backend upload mutations (2–3 days)

**Goal:** Convex can issue dual upload tickets and finalise video records. Backend testable from a script; no UI yet.

### Tasks

- [ ] `convex/files/mutations.ts:107` `getExternalUploadUrl`: accept `mediaKind: "image" | "video"`. When `"video"`, return `{ videoUploadUrl, videoObjectKey, posterUploadUrl, posterObjectKey, expiresAt }`. Object key prefix `videos/<jobId>/<uuid>.mp4` and `…poster.jpg`.
- [ ] `convex/files/mutations.ts:167` `completeExternalUpload`: accept `mediaKind` + video metadata fields. Validate: `mediaKind === "video"` requires `posterObjectKey`, `durationMs`, `width`, `height`, `mimeType === "video/mp4"`, `byteSize ≤ MAX_VIDEO_BYTES` (default 25 MB, configurable).
- [ ] `convex/files/mutations.ts:74` `uploadJobPhoto`: reject when called with `video/*` MIME with stable error code `VIDEO_REQUIRES_EXTERNAL_UPLOAD`.
- [ ] `convex/files/mutations.ts:249` `deleteJobPhoto`: when `mediaKind === "video"`, also delete poster object from external bucket. Best-effort with logging on failure.
- [ ] New: `convex/files/orphanCleanup.ts` cron — sweep `videos/` and `…poster.jpg` objects with no referencing `photos` row, after 24 h grace. Schedule via existing cron infra ([2026-04-24-cron-jobs-architecture-and-cost-reduction.md](../2026-04-24-cron-jobs-architecture-and-cost-reduction.md)).
- [ ] Validation helper: `convex/lib/mediaValidation.ts` with `MAX_VIDEO_BYTES`, `MAX_VIDEO_DURATION_MS`, `ALLOWED_VIDEO_MIMES`. Reads overrides from `platformConfig`.

### Tests

- [ ] Unit: `getExternalUploadUrl` for video returns both URLs and rejects when external storage unhealthy.
- [ ] Unit: `completeExternalUpload` rejects oversized, wrong MIME, missing poster.
- [ ] Unit: `uploadJobPhoto` returns `VIDEO_REQUIRES_EXTERNAL_UPLOAD` for video MIMEs.
- [ ] Integration: Upload → fetch primary URL → fetch poster URL → delete → both objects gone.

### Exit criteria

- A Node script in `scripts/manual/upload-test-video.ts` can upload a real .mp4 + poster end-to-end against the dev Convex deployment and `photos` row is correct.
- `photoStorageAggregate.totalBytes` increments by file size + poster size after upload.

### Risk

Medium. Two PUTs in one transaction is the new shape; orphan handling must be robust. Mitigation: cron sweep with grace period.

---

## Phase 2 — Mobile capture, incident-only (3–5 days)

**Goal:** Cleaners can record a video for an **incident** in the mobile app. Smallest blast radius — incidents are one screen, low-frequency, high-value.

### Tasks

- [ ] Add deps to `jna-cleaners-app`: `react-native-compressor`, `expo-video-thumbnails`, `expo-video` (SDK 54+).
- [ ] New: `services/videoCaptureService.ts` mirroring `services/photoUploadService.ts`. Functions: `captureVideo()`, `pickVideo()`, `transcodeAndPoster()`, `uploadVideo()`.
- [ ] Extend `components/PhotoCapture.tsx` → rename to `MediaCapture.tsx` OR add sibling `VideoCapture.tsx`. Decide based on whether the camera UI shares meaningfully. Default to sibling for v1 to avoid regressing photo capture.
- [ ] Wire into `app/(cleaner)/report-incident.tsx`: add "Record video" button alongside existing "Take photo." Capture → preview with poster + scrub → confirm → upload.
- [ ] Loading state: "preparing video…" during transcode (3–8 s).
- [ ] Error handling: surfaceable error codes (`TRANSCODE_FAILED`, `TOO_LONG`, `TOO_LARGE`, `UPLOAD_FAILED`, `STORAGE_UNAVAILABLE`).
- [ ] Telemetry events from [ARCHITECTURE.md](ARCHITECTURE.md#telemetry).
- [ ] Permissions: re-use `expo-camera` permission (already requested for photo); `expo-image-picker` permission for picker path.

### UI

- [ ] Capture screen: hold-to-record (max 60 s), countdown indicator, mute toggle.
- [ ] Preview: poster + scrub bar + "Use" / "Re-record" buttons.
- [ ] Incident summary: video appears as a tile with poster + duration badge + play overlay.

### Tests

- [ ] Manual: iPhone (HEVC source) → uploaded MP4 plays on Android Chrome admin web.
- [ ] Manual: Android (H.264 source) → uploaded MP4 plays in Safari admin web.
- [ ] Manual: airplane mode mid-upload → clean error, no partial Convex row.
- [ ] Manual: 60.5 s recording → rejected client-side before transcode.

### Exit criteria

- An incident with one photo + one video can be created and viewed back in the mobile app.
- Internal admin (logged into `opscentral-admin` web on `ja-bs.com`) can see the incident with poster (no playback yet — that's Phase 3).

### Risk

Medium. New native module (`react-native-compressor`) requires a development client rebuild via EAS. Test on a physical iPhone and Android device before broadening.

---

## Phase 3 — Web admin playback for incidents (1–2 days)

**Goal:** Admin can review videos that cleaners uploaded in Phase 2.

### Tasks

- [ ] New: `src/components/media/VideoPlayer.tsx` — thin wrapper around `<video controls preload="metadata" poster>` with signed-URL refresh on `error`.
- [ ] New: `src/components/media/MediaThumbnail.tsx` — renders `<img>` for image, poster + play overlay for video.
- [ ] Extend `src/components/incidents/incident-detail-drawer.tsx`: render `MediaThumbnail` per item; clicking opens lightbox.
- [ ] Extend lightbox in `src/components/jobs/job-photos-review-client.tsx`: branch on `mediaKind`. For video, mount `VideoPlayer` in place of `<img>`. Annotation tools hidden for video (per [ADR-0006](adr/0006-annotation-and-feature-scope.md)).
- [ ] `useMediaUrl(photoId, kind)` hook (Convex query wrapper).

### Tests

- [ ] E2E: video uploaded from mobile in Phase 2 plays in admin web Chrome and Safari.
- [ ] Visual: poster shown without playback until user clicks play.
- [ ] Network: signed-URL expiry triggers one transparent retry.

### Exit criteria

- Full incident → video → admin review loop works end-to-end behind `feature.video.enabled` flag.
- Tenant-scoped enable for one internal test tenant.

### Risk

Low. Native `<video>` is well-trodden ground.

---

## Phase 4a — Job before/after + conversation attachments (3–5 days)

**Goal:** Extend video to the two highest-volume photo surfaces. Outbound video flows through our standard capture/transcode pipeline; inbound WhatsApp/SMS video is stored as-is per [ADR-0003 § Inbound](adr/0003-format-codec-and-size-limits.md#inbound-phase-4--accept-as-is-in-v1).

### Tasks

#### Before/after on jobs

- [ ] Extend cleaner before/after capture flow (mobile + cleaner PWA `/cleaner/...`) with the same video button.
- [ ] Extend `src/components/jobs/job-photos-review-client.tsx` to render videos in the per-room grid.
- [ ] Extend `src/components/review/review-photos-review-client.tsx` (manager approval) similarly.
- [ ] `jobSubmissions` snapshot: ensure `mediaKind` is captured at submission time (Phase 0 schema work covers the field; Phase 4a wires the writer in `convex/cleaningJobs/submit.ts` or wherever `photoSnapshot` is built).

#### Outbound conversation video

- [ ] Backend: `conversationMessageAttachments` writer (`convex/conversations/...`) accepts `attachmentKind: "video"` and the new metadata fields.
- [ ] Outbound video: cleaner / admin can attach a video to a conversation message (reuse the videoCaptureService from Phase 2; web admin uses the file-picker path).
- [ ] Web: `src/components/conversations/conversation-thread.tsx` renders `VideoPlayer` for `attachmentKind === "video"`.
- [ ] Mobile: `components/MessageAttachment.tsx` + `components/ConversationThreadView.tsx` render video tile with `expo-video`.

#### Inbound conversation video (accept as-is)

- [ ] Inbound WhatsApp/SMS video is written to `conversationMessageAttachments` with the **original** MIME type and object key — no transcode.
- [ ] `VideoPlayer` (web + mobile) detects unplayable MIMEs and falls back to a **"Download to view"** link pointing at a short-lived signed URL on the original object.
- [ ] `MediaThumbnail` shows a generic "video" tile (no poster) for inbound clips since we have no client-side poster extractor for arbitrary inbound formats.
- [ ] Document the as-is behaviour and the deferred transcode plan in the cleaner-rollout doc so support knows the answer when a customer asks "why does it say download?"

### Tests

- [ ] E2E: cleaner records a "before" video → admin approves → submission snapshot contains video reference with `mediaKind: "video"`.
- [ ] E2E: outbound video sent in a conversation → recipient sees player.
- [ ] Inbound HEVC `.mov` from iPhone WhatsApp → admin web Chrome shows "Download to view" link; admin web Safari plays inline.
- [ ] Inbound MP4 from Android WhatsApp → plays inline in both browsers.
- [ ] Volume: 5 videos on a single job render in gallery without slowness.

### Exit criteria

- Three internal cleaning jobs completed with mixed photo + video evidence end-to-end.
- Outbound conversation video works in both directions (web ↔ mobile).
- Inbound playback verified for at least: iPhone HEVC, Android H.264, manual MP4 upload. "Download to view" fallback works for the unplayable case.

### Risk

Medium. Outbound is well-understood after Phase 2/3; the conversation surface adds new component branches. The inbound fallback is simple but needs the unplayable-MIME detection to be robust across browsers.

---

## Phase 4b — Per-tenant video quota (3–4 days)

**Goal:** Quota enforcement is in place before video reaches more than internal tenants. Implements [ADR-0008](adr/0008-per-tenant-video-quota.md). **Hard gate** before Phase 6 SaaS rollout.

### Tasks

#### Schema

- [ ] Add `videoQuotaUsage` table per [ADR-0008](adr/0008-per-tenant-video-quota.md) with indexes `by_tenant_month`, `by_property_month`.
- [ ] Add `videoQuotaTier` and `videoQuotaSecondsOverride` to `platformConfig` per tenant; defaults from the ADR-0008 tier table.

#### Convex

- [ ] `convex/lib/videoQuota.ts`:
  - `getRemainingSeconds({ tenantId, propertyId })` reads usage row + tier limit + bonus.
  - `consumeSeconds({ tenantId, propertyId, seconds })` upserts the month row.
- [ ] `getExternalUploadUrl` (`mediaKind: "video"` branch): pre-flight check `getRemainingSeconds`. If `< estimatedSeconds`, return error `QUOTA_EXCEEDED` with structured payload.
- [ ] `completeExternalUpload` (`mediaKind: "video"`): on success, call `consumeSeconds(actualDuration)`.
- [ ] Inbound conversation video (accept-as-is, per Phase 4a): consume seconds at insert time using the original-file duration probed from the inbound MIME if available; if duration is unknown, count a flat 30 s as a conservative estimate. Conversations not linked to a property bypass quota for v1, flagged for follow-up.
- [ ] Soft-warn helper: `getQuotaStatus()` returns `{ used, limit, percent, status: "ok" | "warn" | "exceeded" }` for UI badges.

#### UI

- [ ] Cleaner mobile + PWA capture: surface remaining-minutes badge per property. Disable video button on `exceeded`. Show banner on `warn`.
- [ ] Admin: new `/usage/video` page — per-tenant breakdown by property and month, MoM trend chart, manual override action.
- [ ] Email: monthly admin email at 80 % and 100 %.

### Tests

- [ ] Unit: counters increment correctly across month boundary.
- [ ] Unit: `QUOTA_EXCEEDED` blocks upload-URL issuance.
- [ ] Manual: a tenant near limit sees the soft warning; flipping to over the limit blocks capture; admin override unblocks.
- [ ] Concurrency: two parallel uploads racing to the limit don't both succeed (use Convex transactional read+write).

### Exit criteria

- Quota enforced and visible to cleaners and admins.
- Override path documented and tested.
- One internal tenant runs for one full month with quota active and accurate.

### Risk

Medium. Concurrency on `consumeSeconds` is the subtle bit — exercise with a load test.

---

## Phase 5 — Property gallery & checkpoint references (2–3 days)

**Goal:** Properties and critical checkpoints can carry reference videos. Lower priority but completes "everywhere photos exist."

### Tasks

- [ ] Schema: add same `mediaKind` discriminator + video metadata to `propertyImages`, `propertyCriticalCheckpoints`, `jobCheckpointChecks`.
- [ ] Web upload UI: `src/components/properties/property-detail.tsx` and `…critical-checkpoints-panel.tsx` accept video file picker.
- [ ] Web playback in property detail and checkpoint review.
- [ ] Mobile playback for cleaners viewing reference videos during a job.

### Tests

- [ ] Reference video on a critical checkpoint plays for cleaner mid-job.
- [ ] Property gallery renders mixed images + videos.

### Exit criteria

- One property in production has a 30-second walkthrough video used during onboarding by a cleaner.

### Risk

Low. Same patterns established in Phases 1–4.

---

## Phase 6 — Hardening & rollout (ongoing, 2 weeks soak)

### Tasks

- [ ] Enable `feature.video.enabled` for all internal tenants.
- [ ] Watch dashboards: `photoStorageAggregate.totalBytes` growth, B2 cost, mobile crash rate, transcode failure rate, upload-failure rate.
- [ ] Iterate on capture UI based on cleaner feedback (the open question in [README](README.md) about audio default likely surfaces here).
- [ ] Promote to all paying tenants once: (a) zero P1 incidents for 14 days, (b) crash rate ≤ baseline, (c) cleaner NPS unchanged, **(d) Phase 4b quota enforced**.
- [ ] Owner-report integration: surface videos in shareable PDF/HTML reports with appropriate signed-URL expiry.

### Exit criteria

- Feature flag default flipped to `true` everywhere.
- Doc PR removes the "Proposed" status across all six ADRs and replaces with "Accepted" + acceptance date.

---

## Cross-cutting concerns

### Coordination with mobile app

The mobile cleaner app shares the Convex deployment. Phase 0 schema lands first; mobile must run `npm run sync:convex-backend` before mobile builds. Phase 2 ships a new EAS build; coordinate the build with the cleaner team.

### Feature flag matrix

| Flag | Surface | Default |
|---|---|---|
| `feature.video.enabled` | Master switch — all video UI | false |
| `feature.video.surfaces.incident` | Incident capture + review | false |
| `feature.video.surfaces.beforeAfter` | Job before/after | false |
| `feature.video.surfaces.conversation.outbound` | Outbound conversation video | false |
| `feature.video.surfaces.conversation.inboundAcceptAsIs` | Inbound conversation video shown as-is with download fallback | false |
| `feature.video.surfaces.property` | Property gallery + checkpoint references | false |
| `feature.video.audioOnByDefault` | Capture audio by default (toggle visible) | true |
| `feature.video.quotaEnforced` | Hard-block on quota exceeded | false |
| `feature.video.maxDurationSec` | Override cap | 60 |
| `feature.video.maxBytes` | Override cap | 26214400 (25 MB) |
| `feature.video.reportLinkExpirySec` | Owner-facing signed-URL expiry | 86400 (24 h) |

### Documentation deliverables

When the feature ships:
- Update [2026-04-04-canonical-photo-model-adr.md](../2026-04-04-canonical-photo-model-adr.md) with a "Superseded-in-part by [video-support/adr/0001](adr/0001-extend-photos-table-with-media-kind.md)" footer.
- Add a video section to the cleaner onboarding doc (`docs/cleaner-rollout-and-saas/`).
- Update [Photo_Storage_Cost_Analysis.md](../Photo_Storage_Cost_Analysis.md) with measured cost-per-job after Phase 4 soak.

### What success looks like

- ≥ 30 % of incident reports include at least one video within 60 days of Phase 2 GA.
- < 1 % video-upload failure rate (excluding airplane-mode user-cancels).
- < 5 s median capture-to-poster-visible latency on mid-tier Android.
- Zero data-loss incidents tied to orphan cleanup.
- B2 storage cost growth tracks the modeled estimate within 25 %.

### What failure looks like (and what we'd do)

| Failure mode | Response |
|---|---|
| Cleaner crash rate ↑ post Phase 2 | Disable `feature.video.surfaces.incident`; investigate `react-native-compressor` integration; consider dropping to picker-only (no in-app camera capture) |
| Storage cost runs hot | Tighten `maxDurationSec` to 30 s and `maxBytes` to 15 MB via flag; no redeploy |
| WhatsApp inbound video unplayable in many browsers | Schedule the deferred transcode worker from [ADR-0007](adr/0007-inbound-whatsapp-video-transcode-worker.md) as its own milestone (out of scope for this rollout) |
| Reviewers heavily request annotation on video | Schedule the deferred annotation work from [ADR-0006](adr/0006-annotation-and-feature-scope.md) as its own milestone |
