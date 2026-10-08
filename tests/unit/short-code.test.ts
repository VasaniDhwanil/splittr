import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateShortCode } from '@/lib/calculations';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('generateShortCode', () => {
  it('defaults to 6 characters from the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateShortCode();
      expect(code).toHaveLength(6);
      for (const ch of code) expect(ALPHABET).toContain(ch);
    }
  });

  it('honors the requested length', () => {
    expect(generateShortCode(8)).toHaveLength(8);
  });

  it('draws from the CSPRNG, never Math.random', () => {
    const csprng = vi.spyOn(globalThis.crypto, 'getRandomValues');
    const weak = vi.spyOn(Math, 'random');
    generateShortCode(8);
    expect(csprng).toHaveBeenCalled();
    expect(weak).not.toHaveBeenCalled();
  });

  it('maps random bytes onto the alphabet without bias (32 divides 256)', () => {
    const fixed = ((arr: Uint8Array) => {
      arr.set([0, 31, 32, 255, 64, 95]);
      return arr;
    }) as typeof crypto.getRandomValues;
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(fixed);
    // 0->A, 31->9, 32->A, 255->9, 64->A, 95->9
    expect(generateShortCode(6)).toBe('A9A9A9');
  });

  it('spreads across the whole alphabet', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) for (const ch of generateShortCode(8)) seen.add(ch);
    expect(seen.size).toBe(ALPHABET.length);
  });
});
