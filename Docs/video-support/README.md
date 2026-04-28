# Video Support

**Status:** Proposed
**Created:** 2026-04-26
**Owners:** Platform / Cleaner Experience

## Goal

Add video as a first-class media type everywhere photos exist today — job before/after, incidents, conversations, property gallery, critical-checkpoint references. A user who can attach a photo should be able to attach a short video instead, with the same auth, archival, and review semantics.

## Why now

- Cleaners increasingly need motion to prove condition (running faucets, pet damage, broken hardware sounds, walkthroughs).
- WhatsApp inbound already includes video that we silently drop into `documents` — we lose the playback affordance.
- Owner reports look anaemic without a "tour" video for high-value properties.
- B2/MinIO and `expo-video` (SDK 54) make this cheap and well-supported now; it would have been painful 12 months ago.

## Scope

**In scope** (Phase 1 → Phase 5):
- Cleaner-originated videos on cleaning jobs (before / after / incident).
- Standalone incident videos.
- Conversation message attachments.
- Property gallery and critical-checkpoint reference videos.

**Out of scope** (revisit later):
- Video annotations (circle / freehand). Photos keep this; videos defer.
- HLS / DASH adaptive streaming. Progressive download only.
- Server-side transcoding. All transcoding is client-side.
- Live streaming.
- Long-form video (> 60 s default cap, see [ADR-0003](adr/0003-format-codec-and-size-limits.md)).
- Avatars and company logos (photo-only forever).

## Feature flags (rollout kill-switches)

Two env-based flags gate the entire feature. Both default to off — the
feature can ship to production code without becoming visible to users
until both are flipped together.

| Flag | Surface | File | Default | Effect when `true` |
|---|---|---|---|---|
| `NEXT_PUBLIC_ENABLE_VIDEO` | Admin web (Next.js) | `src/lib/feature-flags.ts` | `false` | `MediaThumbnail` / `VideoPlayer` render; galleries (incident drawer, job photos review lightbox) include video rows; without it, video rows are filtered out of every gallery and the player shows a "Video disabled" placeholder. |
| `EXPO_PUBLIC_ENABLE_VIDEO_CAPTURE` | Mobile cleaner (Expo) | `components/VideoCapture.tsx` | `false` | The "Record Video" button appears on the incident form; without it, the component renders nothing and incidents are photo-only. |

**Rollout sequence:**

1. Phase 0 schema deployed to Convex (`mediaKind`, `pendingMediaUploads`, etc.).
2. Admin Next.js build with new components shipped to Vercel — flag still `false`, no behaviour change.
3. Mobile EAS rebuild with `react-native-compressor`, `expo-video-thumbnails`, `expo-video` installed — flag still `false`, no behaviour change.
4. Internal tenant: set both flags to `true` in respective env settings, smoke-test with one cleaner + one admin.
5. Broader rollout: flip flags per tenant in Vercel/EAS env, redeploy/release.
6. Once stable for the soak window described in [IMPLEMENTATION-PLAN](IMPLEMENTATION-PLAN.md) Phase 6: defaults change to `true` in code; envs no longer needed.

**To turn on locally:**

```bash
# Admin (.env.local)
NEXT_PUBLIC_ENABLE_VIDEO=true

# Mobile (jna-cleaners-app/.env)
EXPO_PUBLIC_ENABLE_VIDEO_CAPTURE=true
```

**To turn on in production:** flip the flag in Vercel project env (admin) and EAS build env (mobile), then redeploy / rebuild.

These flags do **not** gate the backend — `getExternalUploadUrl({ mediaKind: "video" })` and the `pendingMediaUploads` cleanup cron run regardless. They only gate the **client UI**. If you need to block video uploads server-side (e.g. emergency rollback), revert the Convex deploy.

## Documents

| Doc | Purpose |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | End-to-end data flow, schema deltas, URL resolution, storage tiers |
| [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) | Phased rollout with concrete tasks, owners, exit criteria |
| [adr/0001-extend-photos-table-with-media-kind.md](adr/0001-extend-photos-table-with-media-kind.md) | Reuse `photos` table with `mediaKind` discriminator vs sibling `videos` table |
| [adr/0002-storage-backend-video-on-b2-only.md](adr/0002-storage-backend-video-on-b2-only.md) | Videos must use external B2/MinIO; legacy Convex `_storage` is image-only |
| [adr/0003-format-codec-and-size-limits.md](adr/0003-format-codec-and-size-limits.md) | H.264/AAC/MP4, ≤ 60 s, ≤ 25 MB post-compression |
| [adr/0004-client-side-compression-and-poster.md](adr/0004-client-side-compression-and-poster.md) | Mandatory on-device transcode + poster JPEG |
| [adr/0005-playback-progressive-no-streaming.md](adr/0005-playback-progressive-no-streaming.md) | `expo-video` (mobile) + native `<video>` (web) over HTTP range, no HLS |
| [adr/0006-annotation-and-feature-scope.md](adr/0006-annotation-and-feature-scope.md) | What videos do NOT inherit from photos in v1 |
| [adr/0007-inbound-whatsapp-video-transcode-worker.md](adr/0007-inbound-whatsapp-video-transcode-worker.md) | **Deferred** — external worker to normalise inbound WhatsApp/SMS video; will ship as a separate follow-up effort |
| [adr/0008-per-tenant-video-quota.md](adr/0008-per-tenant-video-quota.md) | Per-tenant minutes/month quota for SaaS |

## Related prior art (do not contradict)

- [2026-04-04-canonical-photo-model-adr.md](../2026-04-04-canonical-photo-model-adr.md) — every cleaner-originated photo resolves to a `photos` row. Videos extend that model rather than fork it.
- [2026-04-04-photo-upload-architecture-index.md](../2026-04-04-photo-upload-architecture-index.md) — three-app upload contract. Video reuses the external-upload ticket flow.
- [Photo_Storage_Cost_Analysis.md](../Photo_Storage_Cost_Analysis.md) — same B2 economics; video bytes feed `photoStorageAggregate`.
- [Convex-to-MinIO_PhotoArchivingPlan.md](../Convex-to-MinIO_PhotoArchivingPlan.md) — archival policy applies uniformly.

## Resolved decisions (2026-04-26)

The four open questions originally listed here have been answered:

1. **Audio capture in incident videos** — **Record by default**, with a clearly visible mute toggle in the capture UI. Codified in [ADR-0006](adr/0006-annotation-and-feature-scope.md).
2. **Owner-facing playback** — **Signed expiring URLs only, no watermark** in v1. Default expiry 5 min for internal admin/cleaner views; 24 h for owner-facing report links, regenerated server-side on each render. Codified in [ADR-0005](adr/0005-playback-progressive-no-streaming.md).
3. **Per-tenant quota** — **Yes**, cap minutes/property/month before turning this on for SaaS tenants. New ADR with the quota model: [ADR-0008](adr/0008-per-tenant-video-quota.md). Quota landing is now a hard gate before Phase 6 (full SaaS rollout).
4. **WhatsApp inbound** — **Deferred to a future scope.** v1 stores inbound WhatsApp/SMS video **as-is** and the display layer offers a "download to view" affordance when the browser can't play natively (e.g. iPhone HEVC `.mov` viewed on Android Chrome). The transcode worker remains the planned end-state and is documented in [ADR-0007](adr/0007-inbound-whatsapp-video-transcode-worker.md) (status: **Deferred**) so the decision and design aren't lost — but it ships as its own separate effort, not as part of this video-support rollout.

These decisions amend ADRs 0003, 0005, and 0006 and add ADR 0008. ADR 0007 is recorded as a deferred decision for the follow-up effort.
