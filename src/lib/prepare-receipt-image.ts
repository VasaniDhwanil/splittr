// Phone photos are 3 to 8 MB and often HEIC. The scan route sits behind
// Vercel's 4.5 MB body limit and Claude's 5 MB image limit, so every photo is
// re-encoded in the browser as a modest JPEG before it is uploaded.

export const MAX_EDGE = 2000;
export const TARGET_BYTES = 1.5 * 1024 * 1024;
export const QUALITY_STEPS = [0.85, 0.75, 0.65, 0.55, 0.45];
// Last resort when even the lowest quality is over target: shrink and retry.
const SHRINK_FACTOR = 0.75;
const MAX_SHRINKS = 3;
const SHRINK_QUALITY = 0.7;

export const UNSUPPORTED_IMAGE_MESSAGE =
  "This photo format isn't supported. Take a screenshot of the receipt or choose a JPEG.";

export class UnsupportedImageError extends Error {
  constructor(message = UNSUPPORTED_IMAGE_MESSAGE) {
    super(message);
    this.name = 'UnsupportedImageError';
  }
}

/** Scale so the long edge is at most maxEdge. Never upscales. */
export function fitWithin(width: number, height: number, maxEdge = MAX_EDGE) {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge) return { width, height };
  const scale = maxEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function encodeJpeg(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  quality: number
): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2d canvas context');
    // JPEG has no alpha: transparent PNG pixels would turn black
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    return canvas.convertToBlob({ type: 'image/jpeg', quality });
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2d canvas context');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas export failed'))),
      'image/jpeg',
      quality
    );
  });
}

/**
 * Decode, honour EXIF rotation, downscale and re-encode as JPEG.
 * Throws UnsupportedImageError when the browser cannot decode the file.
 */
export async function prepareReceiptImage(file: Blob): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new UnsupportedImageError();
  }

  try {
    let { width, height } = fitWithin(bitmap.width, bitmap.height);
    let blob: Blob | null = null;

    for (const quality of QUALITY_STEPS) {
      blob = await encodeJpeg(bitmap, width, height, quality);
      if (blob.size <= TARGET_BYTES) break;
    }

    for (let i = 0; blob && blob.size > TARGET_BYTES && i < MAX_SHRINKS; i++) {
      width = Math.max(1, Math.round(width * SHRINK_FACTOR));
      height = Math.max(1, Math.round(height * SHRINK_FACTOR));
      blob = await encodeJpeg(bitmap, width, height, SHRINK_QUALITY);
    }

    if (!blob) throw new Error('Image encoding failed');
    return new File([blob], 'receipt.jpg', { type: 'image/jpeg' });
  } finally {
    bitmap.close?.();
  }
}
