// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  FRESH_AMR_METHODS,
  HOSTED_CLIENT_REQUIRES_EMAILED_CODE,
  emailedCodeRequired,
  hasFreshEmailSignIn,
  hmacOAuthCode,
  readFreshSignIn,
} from '@/lib/oauth/stepup';

const NOW = 1_800_000_000_000;
const at = (method: string, ageSeconds: number) => ({ method, timestamp: NOW / 1000 - ageSeconds });
const fresh = (...amr: { method: string; timestamp: number }[]) => hasFreshEmailSignIn({ amr }, NOW);

describe('hasFreshEmailSignIn', () => {
  it('accepts the method names a Splittr email sign-in produces, within 10 minutes', () => {
    expect(FRESH_AMR_METHODS).toEqual(['otp', 'magiclink']);
    expect(fresh(at('otp', 0))).toBe(true);
    expect(fresh(at('otp', 600))).toBe(true);
    expect(fresh(at('magiclink', 120))).toBe(true);
  });

  it('refuses anything older, or dated in the future', () => {
    expect(fresh(at('otp', 601))).toBe(false);
    expect(fresh(at('otp', -61))).toBe(false);
    expect(fresh(at('otp', -30))).toBe(true); // clock skew
  });

  it('refuses every other method, however fresh', () => {
    for (const method of ['password', 'oauth', 'oauth_provider/authorization_code', 'recovery', 'anonymous', 'totp', 'email/signup', 'sso/saml', 'OTP', '']) {
      expect(fresh(at(method, 1)), method).toBe(false);
    }
  });

  it('is not fooled by one fresh non-email entry beside a stale email one', () => {
    expect(fresh(at('otp', 9000), at('password', 1))).toBe(false);
    expect(fresh(at('password', 1), at('otp', 5))).toBe(true);
  });

  it('refuses malformed claims', () => {
    expect(hasFreshEmailSignIn({}, NOW)).toBe(false);
    expect(hasFreshEmailSignIn({ amr: 'otp' }, NOW)).toBe(false);
    expect(hasFreshEmailSignIn({ amr: [null, 5, 'otp', {}] }, NOW)).toBe(false);
    expect(hasFreshEmailSignIn({ amr: [{ method: 'otp', timestamp: '1800000000' }] }, NOW)).toBe(false);
    expect(hasFreshEmailSignIn({ amr: [{ method: 'otp', timestamp: NaN }] }, NOW)).toBe(false);
    expect(hasFreshEmailSignIn({ amr: [{ method: 'otp' }] }, NOW)).toBe(false);
  });
});

describe('readFreshSignIn', () => {
  const claimsClient = (claims: Record<string, unknown> | null, error: unknown = null) => ({
    auth: { getClaims: async () => ({ data: claims ? { claims } : null, error }) },
  });
  const nowSeconds = Math.floor(Date.now() / 1000);
  const freshAmr = [{ method: 'otp', timestamp: nowSeconds - 5 }];

  it('is true for verified claims of this user with a fresh email sign-in', async () => {
    expect(await readFreshSignIn(claimsClient({ sub: 'u1', amr: freshAmr }), 'u1')).toBe(true);
  });

  it('is false for another user\'s claims, an OAuth client\'s token, an error or no claims', async () => {
    expect(await readFreshSignIn(claimsClient({ sub: 'u2', amr: freshAmr }), 'u1')).toBe(false);
    expect(await readFreshSignIn(claimsClient({ sub: 'u1', amr: freshAmr, client_id: 'abc' }), 'u1')).toBe(false);
    expect(await readFreshSignIn(claimsClient(null, { message: 'bad' }), 'u1')).toBe(false);
    expect(await readFreshSignIn(claimsClient(null), 'u1')).toBe(false);
    expect(await readFreshSignIn({ auth: { getClaims: async () => { throw new Error('x'); } } }, 'u1')).toBe(false);
  });
});

describe('emailedCodeRequired and the code HMAC', () => {
  it('always needs the code for the hosted client while the constant is true', () => {
    expect(HOSTED_CLIENT_REQUIRES_EMAILED_CODE).toBe(true);
    expect(emailedCodeRequired({ destination: 'claude.ai' }, true)).toBe(true);
    expect(emailedCodeRequired({ destination: 'claude.ai' }, false)).toBe(true);
  });

  it('lets a fresh sign-in stand in for the code for Claude Code', () => {
    expect(emailedCodeRequired({ destination: 'loopback' }, true)).toBe(false);
    expect(emailedCodeRequired({ destination: 'loopback' }, false)).toBe(true);
  });

  it('binds the code to the account and the request', () => {
    const base = hmacOAuthCode('p'.repeat(40), 'user-1', 'req-1', '123456');
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(hmacOAuthCode('p'.repeat(40), 'user-2', 'req-1', '123456')).not.toBe(base);
    expect(hmacOAuthCode('p'.repeat(40), 'user-1', 'req-2', '123456')).not.toBe(base);
    expect(hmacOAuthCode('p'.repeat(40), 'user-1', 'req-1', '123457')).not.toBe(base);
    expect(hmacOAuthCode('q'.repeat(40), 'user-1', 'req-1', '123456')).not.toBe(base);
  });
});
