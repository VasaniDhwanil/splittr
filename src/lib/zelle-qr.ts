/** Validation for user-uploaded Zelle QR screenshots (from their bank app). */

export const MAX_QR_BYTES = 2 * 1024 * 1024;
export const ZELLE_QR_BUCKET = 'zelle-qr';

type QrType = 'image/png' | 'image/jpeg' | 'image/webp';
const EXT: Record<QrType, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** Identify the image by its magic bytes — the declared Content-Type is not trusted. */
export function sniffImageType(bytes: Uint8Array): QrType | null {
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export type QrValidation =
  | { ok: true; contentType: QrType; ext: string }
  | { ok: false; error: string };

export function validateQrUpload(bytes: Uint8Array): QrValidation {
  if (bytes.length === 0) return { ok: false, error: 'The image is empty' };
  if (bytes.length > MAX_QR_BYTES) return { ok: false, error: 'The image must be under 2 MB' };
  const contentType = sniffImageType(bytes);
  if (!contentType) return { ok: false, error: 'Upload a PNG, JPEG, or WebP image' };
  return { ok: true, contentType, ext: EXT[contentType] };
}
