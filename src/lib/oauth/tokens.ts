/**
 * Codes and tokens for Splittr's own OAuth server (docs/specs/mcp-oauth.md
 * A1, A13, A17). NEVER import this from a client component.
 *
 *   access token   spl_oat_<43 base64url>_<8 check>
 *   refresh token  spl_ort_<43 base64url>_<8 check>
 *
 * The check is the first 6 bytes of HMAC(k, type|body) in base64url, with
 * k = HMAC(pepper, "oauth-token-derivation"). It is verified before any
 * database access so forged tokens cost nothing. (The type is part of the
 * MAC input, so swapping spl_oat_ for spl_ort_ breaks the check.) Only the
 * SHA-256 of the full string, prefix included, is ever stored.
 *
 * Every pair is derived, never random: the first from the authorization code
 * being redeemed and its PKCE verifier, each later one from the refresh token being used. A retried
 * code exchange or refresh can then return the same pair without the server
 * holding any plaintext.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { agentPepper } from '@/lib/agent-tokens';

export type OAuthTokenType = 'access' | 'refresh';

const PREFIX: Record<OAuthTokenType, string> = { access: 'spl_oat_', refresh: 'spl_ort_' };
const SHAPE = /^(spl_oat_|spl_ort_)([A-Za-z0-9_-]{43})_([A-Za-z0-9_-]{8})$/;
const CODE_SHAPE = /^([A-Za-z0-9_-]{43})_([A-Za-z0-9_-]{8})$/;

/** Throws when the pepper is missing or short: callers check isOAuthEnabled() first. */
function derivationKey(pepper: string | null): Buffer {
  if (!pepper) throw new Error('AGENT_TOKEN_PEPPER is not configured');
  return createHmac('sha256', pepper).update('oauth-token-derivation').digest();
}

type CheckedKind = OAuthTokenType | 'code';
const CHECK_TAG: Record<CheckedKind, string> = { access: 'at', refresh: 'rt', code: 'code' };

function checkSuffix(key: Buffer, type: CheckedKind, body: string): string {
  return createHmac('sha256', key).update(`${CHECK_TAG[type]}|${body}`).digest().subarray(0, 6).toString('base64url');
}

function format(key: Buffer, type: OAuthTokenType, rawBody: Buffer): string {
  const body = rawBody.toString('base64url');
  return `${PREFIX[type]}${body}_${checkSuffix(key, type, body)}`;
}

/** SHA-256 hex of the full string, prefix included. Works for codes and tokens. */
export function hashOAuthSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/**
 * A single-use authorization code: 256 random bits and the same kind of keyed
 * check suffix as the tokens (type "code" in the MAC), so a forged code is
 * rejected before any database call.
 */
export function generateAuthorizationCode(pepper: string | null = agentPepper()): string {
  const body = randomBytes(32).toString('base64url');
  return `${body}_${checkSuffix(derivationKey(pepper), 'code', body)}`;
}

/** Shape and check suffix, no database. With no pepper nothing validates. */
export function isWellFormedAuthorizationCode(value: unknown, pepper: string | null = agentPepper()): value is string {
  if (typeof value !== 'string' || !pepper) return false;
  const match = CODE_SHAPE.exec(value);
  if (!match) return false;
  const expected = Buffer.from(checkSuffix(derivationKey(pepper), 'code', match[1]));
  const given = Buffer.from(match[2]);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export interface OAuthTokenPair {
  access: string;
  refresh: string;
}

/** Random pair. Only tests and tools use it: the server derives every pair it issues. */
export function generateOAuthTokenPair(pepper: string | null = agentPepper()): OAuthTokenPair {
  const key = derivationKey(pepper);
  return { access: format(key, 'access', randomBytes(32)), refresh: format(key, 'refresh', randomBytes(32)) };
}

/**
 * The first pair of a grant, from the authorization code AND the PKCE
 * verifier: HMAC(k, "at0|" + code + "|" + verifier) and the "rt0|" twin. The
 * verifier is what only the client holds, so a logged code plus the pepper is
 * not enough to compute live tokens. A retried exchange resends the same
 * verifier (the only one that passes PKCE) and recomputes the same pair.
 */
export function deriveFirstPair(code: string, verifier: string, pepper: string | null = agentPepper()): OAuthTokenPair {
  const key = derivationKey(pepper);
  const body = (tag: 'at0' | 'rt0') => createHmac('sha256', key).update(`${tag}|${code}|${verifier}`).digest();
  return { access: format(key, 'access', body('at0')), refresh: format(key, 'refresh', body('rt0')) };
}

/**
 * The pair that follows `refreshToken`: HMAC(k, "at|" + RT) and
 * HMAC(k, "rt|" + RT). Deterministic, so a replay inside the grace window
 * recomputes exactly what the first call returned.
 */
export function deriveSuccessors(refreshToken: string, pepper: string | null = agentPepper()): OAuthTokenPair {
  const key = derivationKey(pepper);
  const body = (tag: 'at' | 'rt') => createHmac('sha256', key).update(`${tag}|${refreshToken}`).digest();
  return { access: format(key, 'access', body('at')), refresh: format(key, 'refresh', body('rt')) };
}

/**
 * Shape and check suffix, no database. Returns the token's type, or null for
 * anything else (a personal token, a bad check, the wrong length, a
 * non-string). With no pepper nothing validates.
 */
export function parseOAuthToken(value: unknown, pepper: string | null = agentPepper()): OAuthTokenType | null {
  if (typeof value !== 'string' || !pepper) return null;
  const match = SHAPE.exec(value);
  if (!match) return null;
  const type: OAuthTokenType = match[1] === PREFIX.access ? 'access' : 'refresh';
  const expected = Buffer.from(checkSuffix(derivationKey(pepper), type, match[2]));
  const given = Buffer.from(match[3]);
  return given.length === expected.length && timingSafeEqual(given, expected) ? type : null;
}

/** Constant-time check that a PKCE verifier produces the stored S256 challenge. */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  const computed = Buffer.from(createHash('sha256').update(verifier).digest('base64url'));
  const stored = Buffer.from(challenge);
  return computed.length === stored.length && timingSafeEqual(computed, stored);
}

/** RFC 7636: 43 to 128 characters of [A-Za-z0-9-._~]. */
export const PKCE_VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;
export const PKCE_CHALLENGE_RE = /^[A-Za-z0-9\-._~]{43,128}$/;
