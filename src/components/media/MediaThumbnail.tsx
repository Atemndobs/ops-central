"use client";

import Image from "next/image";
import { Play } from "lucide-react";
import type { ComponentProps } from "react";
import { ENABLE_VIDEO } from "@/lib/feature-flags";

/**
 * Polymorphic thumbnail tile (Phase 3 of video-support).
 *
 * Renders an image for `mediaKind: "image"` rows and a poster + play
 * overlay for `mediaKind: "video"` rows. Callers can stay agnostic of
 * the discriminator — every gallery surface (job photos review,
 * incident drawer, owner reports) uses the same component.
 *
 * The component does NOT play video. It's a tile. Tap a video tile
 * to mount a `VideoPlayer` in a lightbox / drawer.
 */
export interface MediaThumbnailProps {
  /**
   * Discriminator from the photos row. `undefined` reads as `"image"`
   * for backward-compat with rows that pre-date the Phase 0 schema add.
   */
  mediaKind?: "image" | "video";
  /** Primary URL — image src for images, video src for videos. */
  url: string | null;
  /** First-frame JPEG. Only used when `mediaKind === "video"`. For
   *  images we fall through to `url`. */
  posterUrl?: string | null;
  /** Alt text. Should describe what's in the frame. */
  alt: string;
  /** Optional duration label rendered in a corner badge for videos. */
  durationMs?: number;
  /** Forwarded to the underlying Next/Image. */
  fill?: boolean;
  /** Forwarded to the underlying Next/Image. */
  sizes?: string;
  /** Forwarded to the underlying Next/Image. */
  className?: string;
  /** Optional click handler (parent typically opens a lightbox). */
  onClick?: () => void;
  /** Forwarded to the wrapper div for keyboard / a11y attributes. */
  wrapperProps?: Omit<ComponentProps<"div">, "onClick" | "className">;
}

export function MediaThumbnail({
  mediaKind,
  url,
  posterUrl,
  alt,
  durationMs,
  fill = true,
  sizes,
  className,
  onClick,
  wrapperProps,
}: MediaThumbnailProps) {
  const kind = mediaKind ?? "image";
  const isVideo = kind === "video";

  // Master kill-switch. Galleries should also filter at the parent level so
  // a hidden tile doesn't leave a layout gap; this is a defensive fallback.
  if (isVideo && !ENABLE_VIDEO) {
    return null;
  }

  // For video tiles the poster IS the visible image; if the poster is
  // missing (legacy / partial row) we fall through to the primary URL —
  // most browsers render a still frame from the video on poster
  // metadata load, which is good enough.
  const renderUrl = isVideo ? posterUrl ?? url : url;

  if (!renderUrl) {
    return (
      <div
        {...wrapperProps}
        onClick={onClick}
        className={
          "flex items-center justify-center bg-muted text-muted-foreground text-xs " +
          (className ?? "")
        }
      >
        No preview
      </div>
    );
  }

  return (
    <div
      {...wrapperProps}
      onClick={onClick}
      className={"relative " + (className ?? "")}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <Image
        src={renderUrl}
        alt={alt}
        fill={fill}
        sizes={sizes}
        className="object-cover"
        // unoptimized: signed external URLs change every read; the
        // Next.js image optimizer can't cache them anyway. Using the
        // raw URL avoids a wasted server round-trip.
        unoptimized
      />
      {isVideo ? (
        <>
          <div
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
            aria-hidden
          >
            <span className="rounded-full bg-black/55 p-2 text-white">
              <Play className="h-5 w-5 fill-white" />
            </span>
          </div>
          {typeof durationMs === "number" && durationMs > 0 ? (
            <span className="pointer-events-none absolute bottom-1 right-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white tabular-nums">
              {formatDurationMs(durationMs)}
            </span>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function formatDurationMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}
