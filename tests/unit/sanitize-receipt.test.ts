// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { sanitizeReceipt } from '@/lib/claude';
import type { ScannedReceipt } from '@/types';

const base: ScannedReceipt = {
  is_receipt: true,
  items: [
    { name: 'Burger', price: 40, quantity: 1 },
    { name: 'Fries', price: 10.5, quantity: 2 },
  ],
  subtotal: 61,
  tax: 5,
  tip: 12.4,
  total: 78.4,
};

describe('sanitizeReceipt tip', () => {
  it('keeps the tip and includes it in the total', () => {
    const out = sanitizeReceipt(base);
    expect(out.tip).toBe(12.4);
    expect(out.subtotal).toBe(61);
    expect(out.total).toBe(78.4);
  });

  it('rounds the tip to cents', () => {
    expect(sanitizeReceipt({ ...base, tip: 12.456 }).tip).toBe(12.46);
  });

  it('clamps a negative, missing or non-numeric tip to 0', () => {
    expect(sanitizeReceipt({ ...base, tip: -5 }).tip).toBe(0);
    expect(sanitizeReceipt({ ...base, tip: undefined as unknown as number }).tip).toBe(0);
    expect(sanitizeReceipt({ ...base, tip: 'lots' as unknown as number }).tip).toBe(0);
    expect(sanitizeReceipt({ ...base, tip: -5 }).total).toBe(66);
  });

  it('caps an absurd tip at the price cap', () => {
    expect(sanitizeReceipt({ ...base, tip: 1e12 }).tip).toBe(100_000);
  });
});
