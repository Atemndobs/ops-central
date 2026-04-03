const MAX_DIMENSION = 512;
const JPEG_QUALITY = 0.82;

export async function uploadImageFile(file: File): Promise<string> {
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
    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
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
