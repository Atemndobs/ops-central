/**
 * Shared media type definitions for the video-support feature (Phase 0).
 *
 * The Convex `photos` table is polymorphic over images and videos via the
 * optional `mediaKind` discriminator (see ADR-0001). Application code that
 * touches photo records should use these types instead of redefining them
 * inline so the discriminator stays consistent across the web app.
 *
 * See:
 * - Docs/video-support/ARCHITECTURE.md
 * - Docs/video-support/adr/0001-extend-photos-table-with-media-kind.md
 */

/** Discriminator on `photos.mediaKind`. Undefined in DB ≡ "image". */
export type MediaKind = "image" | "video";

/** Workflow slot for a photo/video on a cleaning job. Orthogonal to MediaKind. */
export type PhotoType = "before" | "after" | "incident";

/** Origin of a photo/video record. */
export type PhotoSource = "app" | "whatsapp" | "manual";

/**
 * Which addressable view of a media record to fetch a URL for. Mirrors
 * `PhotoUrlKind` on the Convex side (`convex/lib/photoUrls.ts`).
 *
 * `"poster"` only differs from `"primary"` for video rows; on image rows
 * the resolver falls through to the primary URL so callers don't have to
 * branch on `mediaKind` themselves.
 */
export type MediaUrlKind = "primary" | "poster";

/** Default treatment when a row has no `mediaKind` set. */
export const DEFAULT_MEDIA_KIND: MediaKind = "image";

/** Type guard — true if a record represents a video. */
export function isVideo(record: { mediaKind?: MediaKind | null }): boolean {
  return record.mediaKind === "video";
}

/** Type guard — true if a record represents an image (or has no kind set). */
export function isImage(record: { mediaKind?: MediaKind | null }): boolean {
  return (record.mediaKind ?? DEFAULT_MEDIA_KIND) === "image";
}
