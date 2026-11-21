import { describe, expect, it } from 'vitest';
import { isOAuthAccessToken } from '@/lib/supabase/oauth-guard';

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (payload: unknown) => `${b64({ alg: 'ES256', typ: 'JWT' })}.${b64(payload)}.c2ln`;

describe('isOAuthAccessToken', () => {
  it('is true when the payload carries a client_id', () => {
    expect(isOAuthAccessToken(jwt({ sub: 'u', role: 'authenticated', client_id: 'c1dc72a6-2e15-4947-805f-aeeca30126c1' }))).toBe(true);
  });

  it('is false for a first-party session token', () => {
    expect(isOAuthAccessToken(jwt({ sub: 'u', role: 'authenticated', session_id: 's' }))).toBe(false);
  });

  it('treats an empty or null client_id as absent', () => {
    expect(isOAuthAccessToken(jwt({ sub: 'u', client_id: null }))).toBe(false);
    expect(isOAuthAccessToken(jwt({ sub: 'u', client_id: '' }))).toBe(false);
  });

  it('is false for missing and malformed input, never throws', () => {
    for (const bad of [undefined, null, '', 'abc', 'a.b', 'a.b.c', '...', `${b64({})}.not-json.sig`, `${b64({})}.${b64('a string')}.sig`, `${b64({})}.${b64(null)}.sig`, `${b64({})}.${b64([1])}.sig`]) {
      expect(isOAuthAccessToken(bad as string | null | undefined)).toBe(false);
    }
  });

  it('does not need a valid signature: it only classifies', () => {
    expect(isOAuthAccessToken(`${b64({ alg: 'none' })}.${b64({ client_id: 'x' })}.`)).toBe(true);
  });
});
