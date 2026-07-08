import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  createExternalReadUrl,
  getExternalStorageConfigOrNull,
} from "./externalStorage";

type UrlContext = Pick<QueryCtx | MutationCtx, "storage">;

/**
 * Which addressable view of a photo row to resolve.
 *
 * - `"primary"` — the primary stored object. For `mediaKind === "image"` (and
 *   for legacy rows where `mediaKind` is undefined) this IS the image. For
 *   `mediaKind === "video"` it is the canonical MP4.
 * - `"poster"` — the poster JPEG (first frame). Only meaningful for video
 *   rows. For image rows we fall through to `"primary"` so callers don't
 *   have to branch on `mediaKind`.
 *
 * See Docs/video-support/ARCHITECTURE.md and ADR-0001 / ADR-0004.
 */
export type PhotoUrlKind = "primary" | "poster";

export async function resolvePhotoAccessUrl(
  ctx: UrlContext,
  photo: Doc<"photos">,
  kind: PhotoUrlKind = "primary",
): Promise<string | null> {
  if (kind === "poster") {
    // Posters live alongside videos in the external bucket. Try the external
    // poster triple first, then a Convex-storage poster (reserved, not used
    // in v1 per ADR-0002), then fall through to primary so callers can
    // request a poster on an image row and still get a renderable URL.
    if (photo.posterStorageId) {
      return ctx.storage.getUrl(photo.posterStorageId);
    }
    if (
      photo.posterProvider &&
      photo.posterBucket &&
      photo.posterObjectKey
    ) {
      const config = getExternalStorageConfigOrNull();
      if (!config) return null;
      try {
        return await createExternalReadUrl({
          bucket: photo.posterBucket,
          objectKey: photo.posterObjectKey,
        });
      } catch {
        return null;
      }
    }
    // No poster recorded. For images, the primary IS the poster. For videos
    // without a poster (shouldn't happen post-Phase 4a, but possible for
    // partial / migrated rows), this resolves to the video URL — the player
    // will fall back to its own first-frame extraction.
    if ((photo.mediaKind ?? "image") === "image") {
      return resolvePrimary(ctx, photo);
    }
    return resolvePrimary(ctx, photo);
  }

  return resolvePrimary(ctx, photo);
}

async function resolvePrimary(
  ctx: UrlContext,
  photo: Doc<"photos">,
): Promise<string | null> {
  if (photo.storageId) {
    return ctx.storage.getUrl(photo.storageId);
  }

  if (photo.provider && photo.bucket && photo.objectKey) {
    const config = getExternalStorageConfigOrNull();
    if (!config) {
      return null;
    }

    try {
      return await createExternalReadUrl({
        bucket: photo.bucket,
        objectKey: photo.objectKey,
      });
    } catch {
      return null;
    }
  }

  return null;
}
