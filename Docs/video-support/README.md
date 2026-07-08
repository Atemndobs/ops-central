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

Three flags gate the feature. All default to **off**; everyday rollout uses the runtime admin toggle.

| # | Flag | Type | Surface | Where to flip | Effect when `true` |
|---|---|---|---|---|---|
| 1 | `NEXT_PUBLIC_ENABLE_VIDEO` | Build-time env | Admin web | Vercel project env → redeploy | Bundle includes video paths. Required for #2 to do anything. |
| 2 | `featureFlags.video_support` | Runtime (Convex) | Admin web | Settings → Feature flags (admin UI toggle) | Galleries render video tiles, lightbox uses `<VideoPlayer>`, incident drawer plays inline. **This is the everyday on/off switch.** |
| 3 | `EXPO_PUBLIC_ENABLE_VIDEO_CAPTURE` | Build-time env | Mobile cleaner | EAS build env → new build | "Record Video" button appears on the incident form. |

The admin web reads (#1) AND (#2) via the `useIsVideoEnabled()` hook (`src/hooks/use-is-video-enabled.ts`). Either being `false` hides all video UI. The mobile app reads (#3) standalone.

**Why three flags:**

- **#1 (env)** is the build-time **kill-switch** — when `false` the bundle short-circuits and never even queries the runtime flag. Use it to revert the entire feature without a DB write, or to ship a build for a tenant that should never see video.
- **#2 (Convex)** is the **everyday admin toggle** — same Settings page where `theme_switcher`, `voice_messages`, etc. live. Default off; admin flips it when ready. Mirror the existing pattern.
- **#3 (mobile env)** gates the **cleaner-side capture** binary independently of the admin web.

**Rollout sequence:**

1. Phase 0 schema deployed to Convex (`mediaKind`, `pendingMediaUploads`, etc.). ✅
2. Admin Next.js build with new components shipped to Vercel — `NEXT_PUBLIC_ENABLE_VIDEO=true` lit, runtime flag still off → no behaviour change.
3. Mobile EAS rebuild with `react-native-compressor`, `expo-video-thumbnails`, `expo-video` installed — `EXPO_PUBLIC_ENABLE_VIDEO_CAPTURE` still `false` → no behaviour change.
4. Internal soak: open admin Settings → Feature flags → flip **Video support** on. Set `EXPO_PUBLIC_ENABLE_VIDEO_CAPTURE=true` on the next mobile build. Smoke-test with one cleaner + one admin.
5. Broader rollout: keep the runtime flag on, ship mobile builds with the env on for all tenants.
6. Once stable for the soak window in [IMPLEMENTATION-PLAN](IMPLEMENTATION-PLAN.md) Phase 6: env defaults change to `true` in code; the runtime flag becomes the only ongoing gate.

**To turn on locally:**

```bash
# 1. Admin build env (.env.local)
NEXT_PUBLIC_ENABLE_VIDEO=true

# 2. Admin runtime flag — sign in as admin → Settings → Feature flags → "Video support" → on

# 3. Mobile build env (jna-cleaners-app/.env)
EXPO_PUBLIC_ENABLE_VIDEO_CAPTURE=true
```

**To turn on in production:** set `NEXT_PUBLIC_ENABLE_VIDEO=true` in Vercel and redeploy admin (one-time); then flip the runtime flag in Settings → Feature flags whenever you want video on/off — no redeploy needed. For mobile, set `EXPO_PUBLIC_ENABLE_VIDEO_CAPTURE=true` in EAS and ship a new build.

These flags do **not** gate the backend — `getExternalUploadUrl({ mediaKind: "video" })` and the `pendingMediaUploads` cleanup cron run regardless. They only gate the **client UI**. To block uploads server-side, revert the Convex deploy.

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
