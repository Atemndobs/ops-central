/**
 * Build-time feature flags for the admin web.
 *
 * These are read from `process.env` at build time (Next.js inlines
 * `NEXT_PUBLIC_*` vars into the client bundle). To flip a flag in
 * production, change the value in Vercel project env settings and
 * redeploy — there is no runtime override.
 *
 * Why an env-flag instead of the Convex `featureFlags` table:
 *   - These gates affect the JS bundle (component imports, tree-shake-able
 *     code). Convex-table flags can't change what's bundled.
 *   - Matches the mobile pattern (`EXPO_PUBLIC_ENABLE_VIDEO_CAPTURE`) so
 *     ops only has to flip env-vars in two places to enable a feature.
 *
 * If you need a per-tenant or per-user runtime flag instead, use the
 * `featureFlags` Convex table (see `convex/featureFlags/`).
 */

/**
 * Master switch for ALL video-support UI on the admin web.
 *
 * When `false`:
 *   - `MediaThumbnail` returns null for `mediaKind: "video"` rows.
 *   - `VideoPlayer` renders a disabled placeholder.
 *   - Galleries (`IncidentMediaGrid`, job photos review lightbox) filter
 *     out video entries before rendering.
 *
 * Default: `false`. Set `NEXT_PUBLIC_ENABLE_VIDEO=true` in Vercel project
 * env to turn the feature on.
 *
 * Mirrors the mobile flag `EXPO_PUBLIC_ENABLE_VIDEO_CAPTURE` —
 * `jna-cleaners-app/components/VideoCapture.tsx`. Both should be flipped
 * together at rollout time.
 */
export const ENABLE_VIDEO: boolean =
  process.env.NEXT_PUBLIC_ENABLE_VIDEO === "true";

/**
 * Convenience helper for components that prefer a function call over a
 * top-level constant (e.g. inside hooks where the import order matters
 * for testability).
 */
export function isVideoEnabled(): boolean {
  return ENABLE_VIDEO;
}
