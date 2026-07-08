"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { ENABLE_VIDEO as VIDEO_BUNDLE_ENABLED } from "@/lib/feature-flags";

/**
 * Single source of truth for "should the admin web render any video UI?".
 *
 * AND of two gates:
 *
 *   1. **Build-time** (`NEXT_PUBLIC_ENABLE_VIDEO`) — controls whether the
 *      bundle even ships with video paths active. Lets ops emergency-revert
 *      the entire feature without any DB write. Default `false`.
 *
 *   2. **Runtime** (`featureFlags.video_support`) — admin-toggleable from
 *      Settings → Feature flags. Same Convex-backed toggle pattern as
 *      `theme_switcher`, `voice_messages`, etc. Default `false` until an
 *      admin flips it. See `convex/admin/featureFlags.ts`.
 *
 * Both must be `true` for video UI to render. Either being `false` hides
 * everything (galleries filter out video rows, the player shows a disabled
 * placeholder, lightbox carousels skip video slides).
 *
 * Returns `false` while the Convex query is in-flight so we don't briefly
 * render video tiles before the runtime flag arrives.
 */
export function useIsVideoEnabled(): boolean {
  // Cheap short-circuit: if the bundle gate is off there's no point even
  // dispatching the Convex query — the answer can never be `true`.
  const runtimeEnabled = useQuery(
    api.admin.featureFlags.isFeatureEnabled,
    VIDEO_BUNDLE_ENABLED ? { key: "video_support" } : "skip",
  );

  if (!VIDEO_BUNDLE_ENABLED) return false;
  // useQuery returns `undefined` while loading; treat that as off.
  return runtimeEnabled === true;
}
