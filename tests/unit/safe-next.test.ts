import { describe, expect, it } from 'vitest';
import { safeNext } from '@/lib/safe-next';

describe('safeNext', () => {
  it.each([
    ['/\t/evil.com'],
    ['/\n/evil.com'],
    ['/\r/evil.com'],
    ['/\t\\evil.com'],
    ['/%09/evil.com'],
    ['/%0A/evil.com'],
    ['/%09%5Cevil.com'],
    ['/\\evil'],
    ['/%5Cevil'],
    ['//evil'],
    ['/%2F%2Fevil'],
    ['/%2f/evil'],
    ['javascript:alert(1)'],
    ['https://evil.com'],
    ['\\\\evil.com'],
    ['/\u0000x'],
    ['evil'],
    [''],
    [null],
    [undefined],
  ])('rejects %j', (raw) => expect(safeNext(raw as string | null)).toBe('/'));

  it.each([
    ['/profile', '/profile'],
    ['/oauth/consent/abc_DEF-123', '/oauth/consent/abc_DEF-123'],
    ['/groups/join?code=ABC123&x=1', '/groups/join?code=ABC123&x=1'],
    ['/bill/abc#claims', '/bill/abc#claims'],
    ['/a/b?q=%2Fx#h', '/a/b?q=%2Fx#h'],
  ])('keeps %s', (raw, out) => expect(safeNext(raw)).toBe(out));

  it('only ever returns a path that resolves to the same origin', () => {
    for (const raw of ['/a/../../b', '/./x', '/a//b', '/?next=//evil.com', '/#//evil.com']) {
      const out = safeNext(raw);
      expect(new URL(out, 'https://splittr.test').origin).toBe('https://splittr.test');
      expect(out.startsWith('//')).toBe(false);
    }
  });
});
