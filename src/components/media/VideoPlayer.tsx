"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useIsVideoEnabled } from "@/hooks/use-is-video-enabled";

/**
 * Web admin video player (Phase 3 of video-support).
 *
 * Thin wrapper around the native `<video>` element that:
 *
 * - Uses `preload="metadata"` so a gallery of 5 videos doesn't pull the
 *   bytes of every clip until the user hits play.
 * - Honours a poster image so the tile renders with content immediately
 *   (no black box while the player initialises).
 * - Re-fetches a fresh signed URL when the player errors out — admin
 *   sessions are typically long-running and our signed URLs expire after
 *   ~5 minutes per ADR-0005.
 *
 * No HLS, no DRM, no annotations — that's all out of scope for v1 per
 * ADR-0005 / ADR-0006.
 *
 * Sizing: by default the player fills its container (object-fit: contain).
 * A parent `<div>` controls the box; the player just fills it.
 */
export interface VideoPlayerProps {
  /** Current signed URL of the canonical MP4. May be null if unresolved. */
  src: string | null;
  /** First-frame JPEG. Strongly recommended — prevents the black-box
   *  flash before the player has metadata. */
  poster?: string | null;
  /** Duration label override (ms). When omitted the player reads the
   *  metadata as it loads. */
  durationMs?: number;
  /** Optional refetcher invoked on `error` (HTTP 403 from signed-URL
   *  expiry, network failure, etc.). Should return a fresh URL or null
   *  if the photo can no longer be served. */
  onRefetchUrl?: () => Promise<string | null>;
  /** When true, the controls bar is hidden. Use sparingly — the only
   *  in-app surface that wants this is an embedded preview. */
  hideControls?: boolean;
  /** Forwarded to the underlying element. */
  className?: string;
  /** Forwarded to the underlying element. */
  ariaLabel?: string;
}

export function VideoPlayer({
  src,
  poster,
  durationMs,
  onRefetchUrl,
  hideControls = false,
  className,
  ariaLabel,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(src);
  const [refetching, setRefetching] = useState(false);

  // Sync external src changes (e.g. parent passes a new photoId).
  useEffect(() => {
    setResolvedSrc(src);
  }, [src]);

  /**
   * Single-shot refresh on error. We don't loop — if the refetch also
   * fails, the player surfaces its native error UI and the user can
   * dismiss / retry manually.
   */
  const handleError = useCallback(() => {
    if (!onRefetchUrl || refetching) return;
    setRefetching(true);
    onRefetchUrl()
      .then((next) => {
        if (next) {
          setResolvedSrc(next);
          // Force the element to reload with the fresh URL.
          requestAnimationFrame(() => {
            videoRef.current?.load();
          });
        }
      })
      .finally(() => setRefetching(false));
  }, [onRefetchUrl, refetching]);

  const videoEnabled = useIsVideoEnabled();

  // Master kill-switch (build env + admin runtime flag). When off, render a
  // disabled placeholder rather than an empty box — most callers shouldn't
  // be reaching this branch because their parent gallery already filtered
  // video out, but the guard catches direct mounts (e.g. an inline player
  // in the incident drawer that ignored its own filter).
  if (!videoEnabled) {
    return (
      <div
        className={
          "flex items-center justify-center bg-muted text-muted-foreground text-sm " +
          (className ?? "")
        }
        role="img"
        aria-label="Video playback disabled"
      >
        Video disabled
      </div>
    );
  }

  if (!resolvedSrc) {
    return (
      <div
        className={
          "flex items-center justify-center bg-muted text-muted-foreground text-sm " +
          (className ?? "")
        }
        role="img"
        aria-label={ariaLabel ?? "Video unavailable"}
      >
        Video unavailable
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      src={resolvedSrc}
      poster={poster ?? undefined}
      controls={!hideControls}
      preload="metadata"
      playsInline
      onError={handleError}
      className={className}
      aria-label={ariaLabel}
      // The browser's native duration display is the canonical source.
      // `durationMs` is only consumed by sibling components for badge
      // rendering — the player doesn't need to be told its own length.
      data-duration-ms={durationMs ?? undefined}
    />
  );
}
