import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  createExternalReadUrl,
  getExternalStorageConfigOrNull,
} from "./externalStorage";

type UrlContext = Pick<QueryCtx | MutationCtx, "storage">;

export async function resolvePhotoAccessUrl(
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
