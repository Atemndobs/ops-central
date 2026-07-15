const MAX_DIMENSION = 512;
const JPEG_QUALITY = 0.82;

/** MIME of every blob this module produces. Must stay in the backend's
 *  ALLOWED_AVATAR_MIMES allowlist (convex/users/avatarUpload.ts). */
export const COMPRESSED_IMAGE_MIME = "image/jpeg";

/**
 * Downscale and re-encode an image for upload.
 *
 * Returns a Blob, NOT a data URL. This used to return `canvas.toDataURL(...)`,
 * and callers wrote that base64 string straight into `users.avatarUrl` — which
 * put a 246 KB image inside a user document on the hottest table in the app and
 * cost GB/month in database reads. Avatars now go through Convex file storage
 * (convex/users/avatarUpload.ts) and only the short URL is stored.
 * See Docs/2026-07-14-convex-database-optimization-playbook.md.
 */
export async function compressImageFile(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please choose an image file.");
  }

  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await loadImage(objectUrl);
    const { width, height } = fitWithinBounds(image.width, image.height, MAX_DIMENSION);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Image processing is not available in this browser.");
    }

    context.drawImage(image, 0, 0, width, height);
    return await canvasToBlob(canvas);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Failed to process the image."));
        }
      },
      COMPRESSED_IMAGE_MIME,
      JPEG_QUALITY,
    );
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load image."));
    image.src = src;
  });
}

function fitWithinBounds(
  originalWidth: number,
  originalHeight: number,
  maxDimension: number,
) {
  if (originalWidth <= maxDimension && originalHeight <= maxDimension) {
    return {
      width: originalWidth,
      height: originalHeight,
    };
  }

  const scale = Math.min(maxDimension / originalWidth, maxDimension / originalHeight);
  return {
    width: Math.max(1, Math.round(originalWidth * scale)),
    height: Math.max(1, Math.round(originalHeight * scale)),
  };
}
