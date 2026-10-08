import { afterEach, describe, expect, it, vi } from 'vitest';
import { siteOrigin, CANONICAL_ORIGIN } from '@/lib/site-origin';
import nextConfig from '../../next.config';

function req(headers: Record<string, string>, url = 'https://www.splittr.cash/api/x') {
  return new Request(url, { headers });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('siteOrigin (links inside outgoing email)', () => {
  it('prefers NEXT_PUBLIC_SITE_URL, without a trailing slash', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://www.splittr.cash/');
    expect(siteOrigin(req({ host: 'evil.example' }))).toBe('https://www.splittr.cash');
  });

  it('never trusts a forged host header', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    expect(siteOrigin(req({ 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' }))).toBe(
      CANONICAL_ORIGIN
    );
    expect(siteOrigin(req({ host: 'evil.example' }, 'https://evil.example/api/x'))).toBe(CANONICAL_ORIGIN);
  });

  it('keeps allowlisted origins (local dev, apex domain)', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    expect(siteOrigin(req({}, 'http://localhost:3000/api/x'))).toBe('http://localhost:3000');
    expect(siteOrigin(req({}, 'https://splittr.cash/api/x'))).toBe('https://splittr.cash');
  });
});

describe('security headers', () => {
  async function headers() {
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === '/(.*)')!;
    return Object.fromEntries(all.headers.map((h) => [h.key.toLowerCase(), h.value]));
  }

  it('forces HTTPS for two years, including subdomains', async () => {
    expect((await headers())['strict-transport-security']).toBe('max-age=63072000; includeSubDomains; preload');
  });

  it('sets a CSP that blocks framing, plugins, base-tag and form hijacking', async () => {
    const csp = (await headers())['content-security-policy'];
    for (const directive of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"]) {
      expect(csp).toContain(directive);
    }
  });

  it('keeps the existing hardening headers', async () => {
    const h = await headers();
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });
});
