/**
 * Server-side validation constants and helpers for the video-support feature.
 *
 * The numbers here are the *backend ceiling* — clients should reject earlier
 * with a friendlier message before even requesting an upload ticket. The
 * backend re-validates as a safety net so a malicious or buggy client cannot
 * sneak through.
 *
 * See:
 * - Docs/video-support/adr/0003-format-codec-and-size-limits.md
 * - Docs/video-support/adr/0002-storage-backend-video-on-b2-only.md
 */

// ─── Limits ──────────────────────────────────────────────────────────────────

/** Hard cap on stored video duration (post-clip). 60s per ADR-0003. */
export const MAX_VIDEO_DURATION_MS = 60_000;

/** Hard cap on stored video bytes (post-transcode). 25 MiB per ADR-0003. */
export const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

/** Hard cap on poster size. Posters are JPEG, ~50–200 KB typical. 1 MiB ceiling. */
export const MAX_POSTER_BYTES = 1 * 1024 * 1024;

// ─── Allowed MIME types ─────────────────────────────────────────────────────

/** Canonical stored video MIME. ADR-0003 commits to H.264/AAC in MP4. */
export const ALLOWED_VIDEO_MIMES: ReadonlyArray<string> = ["video/mp4"];

/** Allowed poster MIMEs. JPEG only — keeps the gallery thumbnail path simple. */
export const ALLOWED_POSTER_MIMES: ReadonlyArray<string> = [
  "image/jpeg",
  "image/jpg",
];

// ─── Error codes (stable, contracted with clients) ──────────────────────────

export const ERROR_CODES = {
  /** `uploadJobPhoto` was called with a video MIME. Caller must use the
   *  external upload path (`getExternalUploadUrl` with `mediaKind: "video"`)
   *  per ADR-0002. */
  VIDEO_REQUIRES_EXTERNAL_UPLOAD: "VIDEO_REQUIRES_EXTERNAL_UPLOAD",
  /** Video MIME outside the allowlist. */
  VIDEO_MIME_NOT_ALLOWED: "VIDEO_MIME_NOT_ALLOWED",
  /** Poster MIME outside the allowlist. */
  POSTER_MIME_NOT_ALLOWED: "POSTER_MIME_NOT_ALLOWED",
  /** Stored video exceeds the byte ceiling. */
  VIDEO_TOO_LARGE: "VIDEO_TOO_LARGE",
  /** Stored video exceeds the duration ceiling. */
  VIDEO_TOO_LONG: "VIDEO_TOO_LONG",
  /** External storage (B2/MinIO) is required but not configured for this
   *  deployment. ADR-0002 forbids the legacy Convex storage path for video. */
  EXTERNAL_STORAGE_REQUIRED_FOR_VIDEO: "EXTERNAL_STORAGE_REQUIRED_FOR_VIDEO",
  /** Video upload completion is missing the poster fields. Per ADR-0004
   *  every video must ship with a client-extracted poster. */
  VIDEO_REQUIRES_POSTER: "VIDEO_REQUIRES_POSTER",
} as const;

export type MediaErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

// ─── Helpers ────────────────────────────────────────────────────────────────

/** True when the MIME indicates a video file. Case-insensitive. */
export function isVideoMime(mime: string | undefined | null): boolean {
  return !!mime && mime.toLowerCase().startsWith("video/");
}

/**
 * Throws a structured error if the video doesn't meet the canonical
 * format / size / duration constraints. Used by `completeExternalUpload`.
 *
 * Errors are thrown as `Error` with a `code` property the client can
 * branch on — Convex serialises Error properties through to the caller.
 */
export function assertCanonicalVideo(args: {
  mimeType: string;
  byteSize: number;
  durationMs: number | undefined;
}): void {
  if (!ALLOWED_VIDEO_MIMES.includes(args.mimeType)) {
    throw mediaError(
      ERROR_CODES.VIDEO_MIME_NOT_ALLOWED,
      `Video MIME "${args.mimeType}" is not allowed. Allowed: ${ALLOWED_VIDEO_MIMES.join(", ")}.`,
    );
  }
  if (args.byteSize > MAX_VIDEO_BYTES) {
    throw mediaError(
      ERROR_CODES.VIDEO_TOO_LARGE,
      `Video is ${args.byteSize} bytes; ceiling is ${MAX_VIDEO_BYTES}.`,
    );
  }
  if (args.durationMs != null && args.durationMs > MAX_VIDEO_DURATION_MS) {
    throw mediaError(
      ERROR_CODES.VIDEO_TOO_LONG,
      `Video is ${args.durationMs}ms; ceiling is ${MAX_VIDEO_DURATION_MS}ms.`,
    );
  }
}

export function assertCanonicalPoster(args: {
  mimeType: string;
  byteSize?: number;
}): void {
  if (!ALLOWED_POSTER_MIMES.includes(args.mimeType)) {
    throw mediaError(
      ERROR_CODES.POSTER_MIME_NOT_ALLOWED,
      `Poster MIME "${args.mimeType}" is not allowed. Allowed: ${ALLOWED_POSTER_MIMES.join(", ")}.`,
    );
  }
  if (args.byteSize != null && args.byteSize > MAX_POSTER_BYTES) {
    throw mediaError(
      ERROR_CODES.VIDEO_TOO_LARGE, // reuse: poster overflow is a video-side problem
      `Poster is ${args.byteSize} bytes; ceiling is ${MAX_POSTER_BYTES}.`,
    );
  }
}

/**
 * Build a structured error. Convex propagates `Error` instances to the
 * client serialised; we attach the `code` to `message` as a JSON prefix
 * the client can parse if needed, and also as a property for environments
 * that preserve own-properties on Error.
 */
function mediaError(code: MediaErrorCode, message: string): Error {
  const err = new Error(`[${code}] ${message}`);
  // @ts-expect-error: Augment for clients that read err.code
  err.code = code;
  return err;
}
