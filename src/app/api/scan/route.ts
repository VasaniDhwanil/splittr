import { NextRequest, NextResponse } from 'next/server';
import { scanReceipt, NotAReceiptError } from '@/lib/claude';
import { rateLimit, clientIp } from '@/lib/rate-limit';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
// The browser sends a JPEG under 2 MB. Vercel rejects bodies over 4.5 MB before
// this route runs and Claude rejects images over 5 MB of base64 (about 3.7 MB
// of bytes), so 4 MB is the most that could ever work.
const MAX_SIZE = 4 * 1024 * 1024;

// Every scan costs real money (vision model call) — throttle per IP
const SCAN_LIMIT = 10;
const SCAN_WINDOW_MS = 10 * 60 * 1000;

/** Verify the file content actually matches an allowed image format. */
function sniffImageType(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer.subarray(0, 4).toString('ascii') === 'GIF8') return 'image/gif';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

export async function POST(request: NextRequest) {
  // Set once the upload is read, so a failure can be logged without the image
  let imageInfo: { bytes: number; type: string } | null = null;
  try {
    const limit = rateLimit(`scan:${clientIp(request)}`, SCAN_LIMIT, SCAN_WINDOW_MS);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many scans — try again in a few minutes', code: 'rate_limited' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
      );
    }

    const formData = await request.formData();
    const file = formData.get('receipt') as File | null;

    if (!file) {
      return NextResponse.json(
        { error: 'No receipt image provided', code: 'unsupported_image' },
        { status: 400 }
      );
    }

    if (file.type && !ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'Unsupported file type — upload a photo of your receipt', code: 'unsupported_image' },
        { status: 400 }
      );
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: 'Image too large (max 4MB)', code: 'too_large' },
        { status: 413 }
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Don't trust the declared MIME type — sniff the actual bytes
    const actualType = sniffImageType(buffer);
    if (!actualType) {
      return NextResponse.json(
        { error: 'That file is not a valid image', code: 'unsupported_image' },
        { status: 400 }
      );
    }

    imageInfo = { bytes: buffer.length, type: actualType };
    const base64 = buffer.toString('base64');
    const receiptData = await scanReceipt(base64, actualType);

    return NextResponse.json(receiptData);
  } catch (error) {
    if (error instanceof NotAReceiptError) {
      return NextResponse.json(
        { error: error.message, code: 'not_a_receipt' },
        { status: 422 }
      );
    }
    console.error('[scan] failed', { image: imageInfo, error });
    return NextResponse.json(
      { error: 'Failed to scan receipt', code: 'scan_failed' },
      { status: 500 }
    );
  }
}
