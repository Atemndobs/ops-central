/**
 * Burns a timestamp label directly into the image pixels using the Canvas API.
 * The result is a new JPEG data URL with the timestamp permanently overlaid
 * in the bottom-left corner.
 */
export function stampImageWithTimestamp(dataUrl: string, timestamp: Date): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error("Failed to load image for timestamp stamping."));
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        // If canvas is unavailable, return the original unstamped image
        resolve(dataUrl);
        return;
      }

      ctx.drawImage(img, 0, 0);

      const label = timestamp.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      });

      // Scale font and padding relative to image width so it looks right on any resolution
      const fontSize = Math.max(28, Math.round(canvas.width * 0.035));
      const padding = Math.round(fontSize * 0.5);

      ctx.font = `bold ${fontSize}px monospace`;
      const textMetrics = ctx.measureText(label);
      const textWidth = textMetrics.width;
      const textHeight = fontSize;

      const bgX = padding;
      const bgY = canvas.height - padding * 2 - textHeight;

      // Semi-transparent dark pill behind the text
      ctx.fillStyle = "rgba(0, 0, 0, 0.60)";
      const bgPadX = Math.round(padding * 0.75);
      const bgPadY = Math.round(padding * 0.5);
      ctx.beginPath();
      const r = Math.round(fontSize * 0.25);
      const rx = bgX - bgPadX;
      const ry = bgY - bgPadY;
      const rw = textWidth + bgPadX * 2;
      const rh = textHeight + bgPadY * 2;
      ctx.moveTo(rx + r, ry);
      ctx.lineTo(rx + rw - r, ry);
      ctx.arcTo(rx + rw, ry, rx + rw, ry + r, r);
      ctx.lineTo(rx + rw, ry + rh - r);
      ctx.arcTo(rx + rw, ry + rh, rx + rw - r, ry + rh, r);
      ctx.lineTo(rx + r, ry + rh);
      ctx.arcTo(rx, ry + rh, rx, ry + rh - r, r);
      ctx.lineTo(rx, ry + r);
      ctx.arcTo(rx, ry, rx + r, ry, r);
      ctx.closePath();
      ctx.fill();

      // White text
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, bgX, bgY + textHeight);

      resolve(canvas.toDataURL("image/jpeg", 0.92));
    };
    img.src = dataUrl;
  });
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read file."));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Unexpected FileReader result."));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, payload] = dataUrl.split(",");
  if (!meta || !payload) {
    throw new Error("Invalid data URL.");
  }

  const mimeMatch = meta.match(/data:(.*?);base64/);
  const mimeType = mimeMatch?.[1] ?? "application/octet-stream";
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}
