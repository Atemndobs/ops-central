import type { PendingUpload } from "@/features/cleaner/offline/types";

export type IncidentPhotoPreviewSource = {
  photoId?: string;
  url?: string | null;
};

export function getIncidentPhotoPreviews(args: {
  photoRefs: string[];
  pendingUploads: PendingUpload[];
  serverIncidentPhotos?: IncidentPhotoPreviewSource[];
}): Array<{ photoRef: string; url: string }> {
  const serverPhotosById = new Map(
    (args.serverIncidentPhotos ?? [])
      .filter(
        (photo): photo is { photoId: string; url?: string | null } =>
          typeof photo.photoId === "string",
      )
      .map((photo) => [photo.photoId, photo.url ?? null]),
  );

  return args.photoRefs
    .map((photoRef) => {
      const pendingUrl = args.pendingUploads.find((upload) => upload.id === photoRef)?.fileDataUrl;
      if (typeof pendingUrl === "string" && pendingUrl.length > 0) {
        return { photoRef, url: pendingUrl };
      }

      const serverUrl = serverPhotosById.get(photoRef);
      if (typeof serverUrl === "string" && serverUrl.length > 0) {
        return { photoRef, url: serverUrl };
      }

      return null;
    })
    .filter((preview): preview is { photoRef: string; url: string } => preview !== null);
}
