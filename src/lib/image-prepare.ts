/** Browser-only: downscale/compress an uploaded image before sending it to the model. */

const MAX_DIM = 1568; // px on the longest side — plenty for reading on-screen error codes
const JPEG_QUALITY = 0.9;
const SKIP_BYTES = 1.5 * 1024 * 1024; // small images go through untouched

export type PreparedImage = { base64: string; mimeType: string; bytes: number; resized: boolean };

export const fileToBase64 = (f: File) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] ?? "");
    r.onerror = () => rej(new Error("Could not read image"));
    r.readAsDataURL(f);
  });

/**
 * Returns the image as base64, downscaling to at most MAX_DIM px and re-encoding
 * as JPEG when the upload is large. Falls back to the untouched file if the
 * browser cannot decode it.
 */
export async function prepareImageForAnalysis(file: File): Promise<PreparedImage> {
  const direct = async (): Promise<PreparedImage> => ({
    base64: await fileToBase64(file),
    mimeType: file.type,
    bytes: file.size,
    resized: false,
  });
  if (file.size <= SKIP_BYTES) return direct();
  try {
    const bmp = await createImageBitmap(file);
    try {
      const scale = Math.min(1, MAX_DIM / Math.max(bmp.width, bmp.height));
      if (scale >= 1) return direct();
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bmp.width * scale));
      canvas.height = Math.max(1, Math.round(bmp.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) return direct();
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      const base64 = canvas.toDataURL("image/jpeg", JPEG_QUALITY).split(",")[1] ?? "";
      if (!base64) return direct();
      return { base64, mimeType: "image/jpeg", bytes: Math.round(base64.length * 0.75), resized: true };
    } finally {
      bmp.close();
    }
  } catch {
    return direct();
  }
}
