// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  deriveFirstPair,
  deriveSuccessors,
  generateAuthorizationCode,
  generateOAuthTokenPair,
  hashOAuthSecret,
  isWellFormedAuthorizationCode,
  parseOAuthToken,
  verifyPkceS256,
} from '@/lib/oauth/tokens';
import { generateAgentToken } from '@/lib/agent-tokens';

const PEPPER = 'test-pepper-0123456789-0123456789-abcdef';
const OTHER = 'another-pepper-0123456789-0123456789-xyz';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

describe('oauth token format', () => {
  it('has a prefix, 256 random bits and an 8 character check', () => {
    const { access, refresh } = generateOAuthTokenPair(PEPPER);
    expect(access).toMatch(/^spl_oat_[A-Za-z0-9_-]{43}_[A-Za-z0-9_-]{8}$/);
    expect(refresh).toMatch(/^spl_ort_[A-Za-z0-9_-]{43}_[A-Za-z0-9_-]{8}$/);
    expect(Buffer.from(access.slice(8, 51), 'base64url')).toHaveLength(32);
    expect(access).not.toBe(refresh);
    expect(generateOAuthTokenPair(PEPPER).access).not.toBe(access);
  });

  it('is recognised by type and nothing else', () => {
    const { access, refresh } = generateOAuthTokenPair(PEPPER);
    expect(parseOAuthToken(access, PEPPER)).toBe('access');
    expect(parseOAuthToken(refresh, PEPPER)).toBe('refresh');
    expect(parseOAuthToken(generateAgentToken().token, PEPPER)).toBeNull();
  });

  it('rejects every single-character edit anywhere in the token', () => {
    const { access } = generateOAuthTokenPair(PEPPER);
    let tried = 0;
    for (let i = 0; i < access.length; i++) {
      const replacement = access[i] === 'A' ? 'B' : 'A';
      const edited = access.slice(0, i) + replacement + access.slice(i + 1);
      expect(parseOAuthToken(edited, PEPPER), `edit at ${i}`).toBeNull();
      tried++;
    }
    expect(tried).toBe(access.length);
  });

  it('rejects every character substitution in the check suffix', () => {
    const { refresh } = generateOAuthTokenPair(PEPPER);
    const start = refresh.length - 8;
    for (let i = start; i < refresh.length; i++) {
      for (const c of ALPHABET) {
        if (c === refresh[i]) continue;
        const edited = refresh.slice(0, i) + c + refresh.slice(i + 1);
        expect(parseOAuthToken(edited, PEPPER)).toBeNull();
      }
    }
  });

  it('rejects wrong prefixes, lengths, padding, whitespace and non-strings', () => {
    const { access, refresh } = generateOAuthTokenPair(PEPPER);
    for (const bad of [
      access.replace('spl_oat_', 'spl_ort_'),
      refresh.replace('spl_ort_', 'spl_oat_'),
      access.replace('spl_oat_', 'spl_pat_'),
      access.slice(0, -1),
      `${access}A`,
      ` ${access}`,
      `${access}\n`,
      access.toUpperCase(),
      access.replace('_', '-'),
      '',
      'spl_oat_',
      undefined,
      null,
      42,
      {},
      [access],
    ]) {
      expect(parseOAuthToken(bad, PEPPER)).toBeNull();
    }
  });

  it('does not validate under another pepper, or with no pepper', () => {
    const { access } = generateOAuthTokenPair(PEPPER);
    expect(parseOAuthToken(access, OTHER)).toBeNull();
    expect(parseOAuthToken(access, null)).toBeNull();
    expect(() => generateOAuthTokenPair(null)).toThrow();
    expect(() => deriveSuccessors(access, null)).toThrow();
  });
});

describe('derived successors', () => {
  const { refresh } = generateOAuthTokenPair(PEPPER);

  it('are deterministic', () => {
    expect(deriveSuccessors(refresh, PEPPER)).toEqual(deriveSuccessors(refresh, PEPPER));
  });

  it('differ per input, per type, and from the input', () => {
    const a = deriveSuccessors(refresh, PEPPER);
    const b = deriveSuccessors(generateOAuthTokenPair(PEPPER).refresh, PEPPER);
    expect(a.access).not.toBe(b.access);
    expect(a.refresh).not.toBe(b.refresh);
    expect(a.access.slice(8)).not.toBe(a.refresh.slice(8));
    expect(a.refresh).not.toBe(refresh);
    expect(deriveSuccessors(refresh, OTHER).refresh).not.toBe(a.refresh);
  });

  it('are valid tokens of the right type and chain', () => {
    const a = deriveSuccessors(refresh, PEPPER);
    expect(parseOAuthToken(a.access, PEPPER)).toBe('access');
    expect(parseOAuthToken(a.refresh, PEPPER)).toBe('refresh');
    const next = deriveSuccessors(a.refresh, PEPPER);
    expect(next.refresh).not.toBe(a.refresh);
    expect(parseOAuthToken(next.refresh, PEPPER)).toBe('refresh');
  });
});

describe('the first pair, derived from the code and the PKCE verifier', () => {
  const code = generateAuthorizationCode(PEPPER);
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

  it('is deterministic, valid, and of the right types', () => {
    const a = deriveFirstPair(code, verifier, PEPPER);
    expect(a).toEqual(deriveFirstPair(code, verifier, PEPPER));
    expect(parseOAuthToken(a.access, PEPPER)).toBe('access');
    expect(parseOAuthToken(a.refresh, PEPPER)).toBe('refresh');
  });

  it('differs per code, per verifier, per pepper, and from every derived successor', () => {
    const a = deriveFirstPair(code, verifier, PEPPER);
    expect(deriveFirstPair(generateAuthorizationCode(PEPPER), verifier, PEPPER).access).not.toBe(a.access);
    expect(deriveFirstPair(code, verifier + 'x', PEPPER).access).not.toBe(a.access);
    expect(deriveFirstPair(code, verifier + 'x', PEPPER).refresh).not.toBe(a.refresh);
    expect(deriveFirstPair(code, verifier, OTHER).access).not.toBe(a.access);
    expect(deriveSuccessors(code, PEPPER).access).not.toBe(a.access);
    expect(deriveSuccessors(code, PEPPER).refresh).not.toBe(a.refresh);
    expect(a.access.slice(8)).not.toBe(a.refresh.slice(8));
  });

  it('cannot be computed from the code alone, and does not contain either', () => {
    const a = deriveFirstPair(code, verifier, PEPPER);
    for (const secret of [code, verifier]) {
      expect(a.access).not.toContain(secret);
      expect(a.refresh).not.toContain(secret);
    }
  });
});

describe('hashing and codes', () => {
  it('hashes the full string, prefix included', () => {
    const { access } = generateOAuthTokenPair(PEPPER);
    expect(hashOAuthSecret(access)).toBe(createHash('sha256').update(access).digest('hex'));
    expect(hashOAuthSecret(access)).not.toBe(hashOAuthSecret(access.slice(8)));
  });

  it('makes 256-bit codes with a keyed check suffix', () => {
    const code = generateAuthorizationCode(PEPPER);
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}_[A-Za-z0-9_-]{8}$/);
    expect(isWellFormedAuthorizationCode(code, PEPPER)).toBe(true);
    expect(Buffer.from(code.slice(0, 43), 'base64url')).toHaveLength(32);
    expect(isWellFormedAuthorizationCode(`${code}x`, PEPPER)).toBe(false);
    expect(isWellFormedAuthorizationCode(generateOAuthTokenPair(PEPPER).access, PEPPER)).toBe(false);
    expect(generateAuthorizationCode(PEPPER)).not.toBe(code);
  });

  it('rejects a forged code: right shape, wrong check, another pepper, no pepper, bare body', () => {
    const code = generateAuthorizationCode(PEPPER);
    const body = code.slice(0, 43);
    expect(isWellFormedAuthorizationCode(`${body}_AAAAAAAA`, PEPPER)).toBe(false);
    expect(isWellFormedAuthorizationCode(code, OTHER)).toBe(false);
    expect(isWellFormedAuthorizationCode(code, null)).toBe(false);
    expect(isWellFormedAuthorizationCode(body, PEPPER)).toBe(false);
    expect(isWellFormedAuthorizationCode(undefined, PEPPER)).toBe(false);
  });

  it('keeps the check suffix of a code apart from a token\'s: the type is part of the MAC', () => {
    const code = generateAuthorizationCode(PEPPER);
    const body = code.slice(0, 43);
    const asAccess = `spl_oat_${code}`;
    const asRefresh = `spl_ort_${code}`;
    expect(parseOAuthToken(asAccess, PEPPER)).toBeNull();
    expect(parseOAuthToken(asRefresh, PEPPER)).toBeNull();
    // and a token's check is not a code's check
    const tok = generateOAuthTokenPair(PEPPER).access;
    const tokBody = tok.slice(8, 8 + 43);
    const tokCheck = tok.slice(-8);
    expect(isWellFormedAuthorizationCode(`${tokBody}_${tokCheck}`, PEPPER)).toBe(false);
    expect(body).toHaveLength(43);
  });

  it('checks PKCE S256 against the RFC 7636 example', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    expect(verifyPkceS256(verifier, challenge)).toBe(true);
    expect(verifyPkceS256(verifier + 'x', challenge)).toBe(false);
    expect(verifyPkceS256(verifier, challenge.slice(0, -1))).toBe(false);
  });
});
