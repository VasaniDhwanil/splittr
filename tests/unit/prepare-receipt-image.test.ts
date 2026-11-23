import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_EDGE,
  QUALITY_STEPS,
  TARGET_BYTES,
  UnsupportedImageError,
  fitWithin,
  prepareReceiptImage,
} from '@/lib/prepare-receipt-image';

describe('fitWithin', () => {
  it('scales a landscape photo to a 2000 px long edge', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 2000, height: 1500 });
  });
  it('scales a portrait photo to a 2000 px long edge', () => {
    expect(fitWithin(3000, 4000)).toEqual({ width: 1500, height: 2000 });
  });
  it('does not upscale small images', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(2000, 1000)).toEqual({ width: 2000, height: 1000 });
  });
  it('never returns a zero side', () => {
    expect(fitWithin(100000, 10)).toEqual({ width: 2000, height: 1 });
  });
});

type Draw = { width: number; height: number; quality: number };

function stubBrowser(bitmapSize: { width: number; height: number }, sizeFor: (d: Draw) => number) {
  const draws: Draw[] = [];
  const close = vi.fn();
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ ...bitmapSize, close }))
  );
  class FakeOffscreenCanvas {
    constructor(
      public width: number,
      public height: number
    ) {}
    getContext() {
      return { fillRect() {}, drawImage() {}, fillStyle: '' };
    }
    async convertToBlob({ quality }: { type: string; quality: number }) {
      const d = { width: this.width, height: this.height, quality };
      draws.push(d);
      return new Blob([new Uint8Array(sizeFor(d))], { type: 'image/jpeg' });
    }
  }
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
  return { draws, close };
}

describe('prepareReceiptImage', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('asks the browser to apply EXIF orientation', async () => {
    stubBrowser({ width: 100, height: 100 }, () => 1000);
    await prepareReceiptImage(new Blob(['x']));
    expect(createImageBitmap).toHaveBeenCalledWith(expect.anything(), { imageOrientation: 'from-image' });
  });

  it('downscales a large landscape photo and returns a JPEG file', async () => {
    const { draws, close } = stubBrowser({ width: 4000, height: 3000 }, () => 500_000);
    const out = await prepareReceiptImage(new Blob(['x'], { type: 'image/png' }));
    expect(draws).toEqual([{ width: 2000, height: 1500, quality: QUALITY_STEPS[0] }]);
    expect(out.type).toBe('image/jpeg');
    expect(out.name).toBe('receipt.jpg');
    expect(close).toHaveBeenCalled();
  });

  it('downscales a portrait photo', async () => {
    const { draws } = stubBrowser({ width: 3000, height: 4000 }, () => 500_000);
    await prepareReceiptImage(new Blob(['x']));
    expect(draws[0]).toMatchObject({ width: 1500, height: 2000 });
  });

  it('keeps small images at their size', async () => {
    const { draws } = stubBrowser({ width: 800, height: 600 }, () => 100_000);
    await prepareReceiptImage(new Blob(['x']));
    expect(draws[0]).toMatchObject({ width: 800, height: 600 });
  });

  it('steps quality down until the result is under 1.5 MB', async () => {
    const { draws } = stubBrowser({ width: 4000, height: 3000 }, ({ quality }) =>
      quality > 0.7 ? TARGET_BYTES + 1 : quality > 0.6 ? TARGET_BYTES + 1 : 1_000_000
    );
    const out = await prepareReceiptImage(new Blob(['x']));
    expect(draws.map((d) => d.quality)).toEqual([0.85, 0.75, 0.65, 0.55]);
    expect(out.size).toBe(1_000_000);
  });

  it('shrinks the image when the lowest quality is still too big', async () => {
    const { draws } = stubBrowser({ width: 4000, height: 3000 }, ({ width }) =>
      width > 1200 ? TARGET_BYTES + 1 : 400_000
    );
    const out = await prepareReceiptImage(new Blob(['x']));
    expect(draws.slice(0, QUALITY_STEPS.length).map((d) => d.quality)).toEqual(QUALITY_STEPS);
    expect(draws.at(-1)!.width).toBeLessThan(2000);
    expect(out.size).toBe(400_000);
  });

  it('throws UnsupportedImageError when the browser cannot decode the file', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new DOMException('bad', 'InvalidStateError')));
    await expect(prepareReceiptImage(new Blob(['heic']))).rejects.toBeInstanceOf(UnsupportedImageError);
    await expect(prepareReceiptImage(new Blob(['heic']))).rejects.toThrow(/isn't supported/);
  });

  it('exports the 2000 px cap', () => {
    expect(MAX_EDGE).toBe(2000);
  });
});
