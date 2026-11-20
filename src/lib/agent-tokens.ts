/**
 * Agent access tokens: the secret a signed-in person gives their own AI
 * agent so it can call /api/mcp as them.
 *
 * The token is shown once and stored only as a SHA-256 hash. It is 256 random
 * bits, so the hash needs no salt and looking a token up by its hash leaks
 * nothing through timing. NEVER import this from a client component.
 */
import { createHash, createHmac, randomBytes, randomInt } from 'crypto';

export const TOKEN_PREFIX = 'spl_pat_';
const TOKEN_RE = /^spl_pat_[A-Za-z0-9_-]{43}$/;

export const AGENT_SCOPES = ['read', 'bills:write'] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];

export const TOKEN_EXPIRY_DAYS = [7, 30, 90] as const;
export const DEFAULT_EXPIRY_DAYS = 30;
export const MAX_ACTIVE_TOKENS = 5;
export const MAX_TOKEN_NAME = 60;
export const CODE_TTL_MINUTES = 10;
export const MAX_CODE_ATTEMPTS = 5;

const MIN_PEPPER_BYTES = 32;

export function hashAgentToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateAgentToken(): { token: string; hash: string; last4: string } {
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
  return { token, hash: hashAgentToken(token), last4: token.slice(-4) };
}

/** Shape check only: no database, so garbage costs nothing. */
export function isWellFormedAgentToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_RE.test(value);
}

/** The six digits emailed to prove inbox control before a token is minted. */
export function generateEmailCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * The server secret that keys email-code HMACs. Unset or too short means the
 * feature is off: an HMAC keyed with '' would still "work".
 */
export function agentPepper(env: Record<string, string | undefined> = process.env): string | null {
  const pepper = env.AGENT_TOKEN_PEPPER;
  return pepper && Buffer.byteLength(pepper) >= MIN_PEPPER_BYTES ? pepper : null;
}

/** What is stored for a pending code. Bound to the account it was sent to. */
export function hmacEmailCode(pepper: string, userId: string, code: string): string {
  return createHmac('sha256', pepper).update(`${userId}:${code}`).digest('hex');
}

/**
 * Agent access is on only when it is switched on AND fully configured, so a
 * preview deployment or a half-configured environment stays closed.
 */
export function isAgentAccessEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.MCP_ENABLED === 'true' && agentPepper(env) !== null;
}

/** The requested scopes in canonical order, or null if any is not a known scope. */
export function parseScopes(raw: unknown): AgentScope[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  if (!raw.every((s): s is AgentScope => typeof s === 'string' && (AGENT_SCOPES as readonly string[]).includes(s))) {
    return null;
  }
  return AGENT_SCOPES.filter((scope) => raw.includes(scope));
}
