/**
 * Where Splittr's own OAuth server lives. Every URL it publishes or checks
 * comes from here, never from a request (docs/specs/mcp-oauth.md A9).
 */
import { isAgentAccessEnabled } from '@/lib/agent-tokens';
import { CANONICAL_ORIGIN } from '@/lib/site-origin';

type Env = Record<string, string | undefined>;

/** The raw configured value with one trailing slash removed. */
function rawIssuer(env: Env): string {
  const value = env.OAUTH_ISSUER?.trim();
  return (value || CANONICAL_ORIGIN).replace(/\/$/, '');
}

/** `OAUTH_ISSUER`, default the canonical origin. A bare origin, no trailing slash. */
export function oauthIssuer(env: Env = process.env): string {
  return rawIssuer(env);
}

/** The one protected resource: the MCP endpoint. */
export function oauthResource(env: Env = process.env): string {
  return `${oauthIssuer(env)}/api/mcp`;
}

/** The issuer as a URL, only when it is a bare origin (scheme, host, port). */
function issuerUrl(env: Env): URL | null {
  const raw = rawIssuer(env);
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.origin !== raw) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * OAuth is on only when agent access is on, the OAuth switch is exactly
 * 'true', the issuer is a bare origin, and either this is the production
 * deployment or the issuer is on this machine. A preview deployment shares
 * the production database and must never issue tokens.
 */
export function isOAuthEnabled(env: Env = process.env): boolean {
  if (!isAgentAccessEnabled(env)) return false;
  if (env.MCP_OAUTH_ENABLED !== 'true') return false;
  const issuer = issuerUrl(env);
  if (!issuer) return false;
  const loopback = issuer.hostname === 'localhost' || issuer.hostname === '127.0.0.1';
  return env.VERCEL_ENV === 'production' || loopback;
}
