import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const scanReceipt = vi.fn();
vi.mock('@/lib/claude', () => ({
  scanReceipt: (...args: unknown[]) => scanReceipt(...args),
  NotAReceiptError: class NotAReceiptError extends Error {},
}));

import { POST } from '@/app/api/scan/route';
import { NotAReceiptError } from '@/lib/claude';

// A tiny but valid-looking JPEG header, padded
const jpeg = (size = 64) => {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return bytes;
};

let ip = 0;
const post = (file: Blob | null) => {
  const form = new FormData();
  if (file) form.append('receipt', file, 'receipt.jpg');
  return POST(
    new NextRequest('http://localhost:3000/api/scan', {
      method: 'POST',
      headers: { 'x-forwarded-for': `10.9.9.${++ip}` },
      body: form,
    })
  );
};

describe('POST /api/scan error codes', () => {
  beforeEach(() => {
    scanReceipt.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('succeeds for a normal JPEG', async () => {
    scanReceipt.mockResolvedValue({ is_receipt: true, items: [], subtotal: 0, tax: 0, total: 0 });
    const res = await post(new Blob([jpeg()], { type: 'image/jpeg' }));
    expect(res.status).toBe(200);
    expect(scanReceipt.mock.calls[0][1]).toBe('image/jpeg');
  });

  it('413 too_large above 4 MB', async () => {
    const res = await post(new Blob([jpeg(4 * 1024 * 1024 + 1)], { type: 'image/jpeg' }));
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe('too_large');
    expect(scanReceipt).not.toHaveBeenCalled();
  });

  it('400 unsupported_image for a HEIC type', async () => {
    const res = await post(new Blob([jpeg()], { type: 'image/heic' }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('unsupported_image');
  });

  it('400 unsupported_image when the bytes are not an image', async () => {
    const res = await post(new Blob([new Uint8Array(64).fill(1)], { type: 'image/jpeg' }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('unsupported_image');
  });

  it('422 not_a_receipt', async () => {
    scanReceipt.mockRejectedValue(new NotAReceiptError('nope'));
    const res = await post(new Blob([jpeg()], { type: 'image/jpeg' }));
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('not_a_receipt');
  });

  it('429 rate_limited after 10 scans from one address', async () => {
    scanReceipt.mockResolvedValue({ is_receipt: true, items: [], subtotal: 0, tax: 0, total: 0 });
    const send = () =>
      POST(
        new NextRequest('http://localhost:3000/api/scan', {
          method: 'POST',
          headers: { 'x-forwarded-for': '10.8.8.8' },
          body: (() => {
            const f = new FormData();
            f.append('receipt', new Blob([jpeg()], { type: 'image/jpeg' }), 'r.jpg');
            return f;
          })(),
        })
      );
    let last: Response | undefined;
    for (let i = 0; i < 11; i++) last = await send();
    expect(last!.status).toBe(429);
    expect((await last!.json()).code).toBe('rate_limited');
  });

  it('500 scan_failed, logging image size and type but not the image', async () => {
    scanReceipt.mockRejectedValue(new Error('boom'));
    const res = await post(new Blob([jpeg(100)], { type: 'image/jpeg' }));
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('scan_failed');
    const logged = JSON.stringify((console.error as ReturnType<typeof vi.fn>).mock.calls);
    expect(logged).toContain('"bytes":100');
    expect(logged).toContain('image/jpeg');
  });
});
