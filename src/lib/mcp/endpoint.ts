/**
 * The request pipeline for POST /api/mcp. Each check has its own exit and the
 * order is part of the contract (docs/specs/mcp-implementation.md):
 *
 *   feature switch -> foreign Origin -> token in the URL -> method ->
 *   Authorization shape -> token lookup -> per-token rate limit -> JSON-RPC
 *
 * Cookies are never read and nothing sets one. Nothing here logs a header,
 * a token or an SDK error object.
 */
import { createAdminClient } from '@/lib/supabase/admin';
import {
  hitRateLimit,
  isSameSiteOrigin,
  requestIp,
  resolveAgentToken,
  touchAgentToken,
  type ResolveFailure,
} from '@/lib/agent-access';
import { deleteUnapprovedProposals } from '@/lib/agent-bills';
import { buildAgentTokenStoppedEmail } from '@/lib/agent-emails';
import { hashAgentToken, isAgentAccessEnabled, isWellFormedAgentToken } from '@/lib/agent-tokens';
import { sendEmail } from '@/lib/email';
import { isOAuthEnabled, oauthIssuer } from '@/lib/oauth/config';
import { resolveOAuthAccessToken } from '@/lib/oauth/resolve';
import { hashOAuthSecret, parseOAuthToken } from '@/lib/oauth/tokens';
import { rateLimit } from '@/lib/rate-limit';
import { siteOrigin } from '@/lib/site-origin';
import { MAX_BODY_BYTES, serveMcp } from './server';

export const CALLS_PER_MINUTE = 60;
/** Mutable only so a test can lower the daily cap; nothing in the app writes to it. */
export const MCP_LIMITS = { callsPerDay: 2000 };
/** Failed authentications per address per minute before answers turn into 429. Valid tokens are never counted. */
export const FAILED_AUTH_PER_MINUTE = 30;

const NEW_TOKEN_HINT =
  'Create a new token under Agent access on your Splittr profile page (https://www.splittr.cash/profile).';

const UNAVAILABLE_MESSAGE =
  'Splittr is temporarily unavailable. Your access token is fine: try again shortly.';

const AUTH_MESSAGES: Record<Exclude<ResolveFailure, 'unavailable'> | 'missing', string> = {
  missing: `No access token was sent. Send it as "Authorization: Bearer <token>". ${NEW_TOKEN_HINT}`,
  malformed: `That is not a Splittr access token (they start with spl_pat_). ${NEW_TOKEN_HINT}`,
  unknown: `That access token is not recognised. ${NEW_TOKEN_HINT}`,
  expired: `That access token has expired. ${NEW_TOKEN_HINT}`,
  revoked: `That access token has been revoked. ${NEW_TOKEN_HINT}`,
  suspended: `That access token is paused. Turn it back on, or create a new token, under Agent access on your Splittr profile page (https://www.splittr.cash/profile).`,
};

const OAUTH_MESSAGES = {
  missing: 'No access token was sent. Connect Splittr from your Claude settings, or send a personal token as "Authorization: Bearer <token>".',
  invalid: 'That access token is not valid. Reconnect Splittr from your Claude settings.',
  expired: 'That access token has expired. Refresh it, or reconnect Splittr from your Claude settings.',
  revoked: 'That connection was disconnected. Reconnect Splittr from your Claude settings.',
} as const;
const OAUTH_DISABLED_MESSAGE = 'Sign-in with Claude is not available right now. Try again later, or use a personal token.';

const LEAKED_MESSAGE = `An access token was sent in the URL, so it was revoked: URLs end up in logs. Send tokens only in the Authorization header. ${NEW_TOKEN_HINT}`;
const LEAKED_UNKNOWN_MESSAGE = `Access tokens must be sent in the Authorization header, never in the URL. ${NEW_TOKEN_HINT}`;

function respond(status: number, code: number, message: string, extra: { reason?: string; headers?: Record<string, string> } = {}) {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code, message, ...(extra.reason ? { data: { reason: extra.reason } } : {}) },
      id: null,
    }),
    { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra.headers } }
  );
}

/** The Origins that may call /api/mcp from a browser: this site, and claude.ai once OAuth is on. */
function isAllowedMcpOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  if (isSameSiteOrigin(request)) return true;
  return origin === 'https://claude.ai' && isOAuthEnabled();
}

/** The 401 that sends an OAuth-capable client to sign in (RFC 9728). `error` only when a token was presented. */
function oauthChallenge(tokenPresented: boolean): string {
  const parts = [
    `resource_metadata="${oauthIssuer()}/.well-known/oauth-protected-resource/api/mcp"`,
    'scope="read bills:write"',
  ];
  if (tokenPresented) parts.push('error="invalid_token"');
  return `Bearer ${parts.join(', ')}`;
}

function oauthUnauthorized(reason: 'missing' | 'malformed' | 'unknown' | 'expired' | 'revoked'): Response {
  const message =
    reason === 'missing'
      ? OAUTH_MESSAGES.missing
      : reason === 'expired'
        ? OAUTH_MESSAGES.expired
        : reason === 'revoked'
          ? OAUTH_MESSAGES.revoked
          : OAUTH_MESSAGES.invalid;
  return respond(401, -32001, message, {
    reason,
    headers: { 'WWW-Authenticate': oauthChallenge(reason !== 'missing') },
  });
}

function authFailure(ip: string, reason: Exclude<ResolveFailure, 'unavailable'> | 'missing', detail?: string): Response {
  const counted = rateLimit(`mcp-auth-fail:${ip}`, FAILED_AUTH_PER_MINUTE, 60_000);
  if (!counted.allowed) {
    return respond(429, -32002, 'Too many failed attempts. Wait a minute and try again.', {
      reason: 'rate_limited',
      headers: { 'Retry-After': String(Math.max(1, counted.retryAfterSeconds)) },
    });
  }
  const why = reason === 'suspended' && detail ? ` Why: ${detail}` : '';
  return respond(401, -32001, AUTH_MESSAGES[reason] + why, { reason });
}

/** Any well-formed token in the query string, decoded or not. */
function tokensInQuery(url: URL): string[] {
  let decoded = url.search;
  try {
    decoded = decodeURIComponent(url.search.replace(/\+/g, ' '));
  } catch {
    // keep the raw text
  }
  const found = new Set<string>();
  for (const text of [url.search, decoded]) {
    for (const match of text.matchAll(/spl_(?:pat_[A-Za-z0-9_-]{43}|o[ar]t_[A-Za-z0-9_-]{43}_[A-Za-z0-9_-]{8})/g)) {
      if (isWellFormedAgentToken(match[0]) || parseOAuthToken(match[0]) !== null) found.add(match[0]);
      if (found.size >= 3) return [...found];
    }
  }
  return [...found];
}

/** A token that appeared in a URL has already reached request logs: kill it and tell its owner. */
async function revokeLeakedTokens(request: Request, tokens: string[]): Promise<boolean> {
  const db = createAdminClient();
  const now = new Date().toISOString();
  let revokedAny = false;
  for (const token of tokens) {
    let query = db.from('agent_tokens').update({ revoked_at: now, revoked_reason: 'query_string' });
    if (token.startsWith('spl_pat_')) {
      query = query.eq('token_hash', hashAgentToken(token));
    } else {
      // An OAuth token belongs to a grant: find it, then revoke the grant (its tokens go with it)
      const { data: found, error: lookupError } = await db
        .from('agent_oauth_tokens')
        .select('grant_id')
        .eq('hash', hashOAuthSecret(token))
        .maybeSingle();
      if (lookupError || !found) continue;
      query = query.eq('id', found.grant_id).eq('kind', 'oauth');
    }
    const { data, error } = await query
      .is('revoked_at', null)
      .gt('expires_at', now)
      .select('id, user_id, name');
    if (error || !data || data.length === 0) continue;
    revokedAny = true;
    await deleteUnapprovedProposals(data.map((row) => row.id)).catch(() => {});
    for (const row of data) {
      try {
        const { data: owner } = await db.auth.admin.getUserById(row.user_id);
        const to = owner?.user?.email;
        if (!to) continue;
        const email = buildAgentTokenStoppedEmail({
          tokenName: row.name,
          state: 'revoked',
          reason: 'It was sent in a URL, where it can end up in logs, so it was revoked automatically.',
          profileUrl: `${siteOrigin(request)}/profile`,
        });
        await sendEmail({ to, ...email });
      } catch {
        // the revocation already happened; the notice is best effort
      }
    }
  }
  return revokedAny;
}

/**
 * Reads at most MAX_BODY_BYTES. The transport would accept a JSON-RPC batch of
 * up to 100 messages for the price of one rate-limit hit, so the endpoint
 * parses the body itself and refuses arrays before the transport sees them.
 */
async function readJsonBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const tooLarge = () => ({
    ok: false as const,
    response: respond(413, -32000, `Request body too large: the limit is ${MAX_BODY_BYTES} bytes.`, { reason: 'too_large' }),
  });
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return tooLarge();

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = request.body?.getReader();
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return tooLarge();
      }
      chunks.push(value);
    }
  }
  try {
    return { ok: true, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  } catch {
    return { ok: false, response: respond(400, -32700, 'Parse error: Invalid JSON', { reason: 'parse_error' }) };
  }
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const scheme = /^Bearer[ \t]+([\s\S]*)$/i.exec(header.trim());
  if (!scheme) return null; // another scheme, or nothing usable: same as no token
  return /^\S+$/.test(scheme[1]) ? scheme[1] : '';
}

export async function handleMcpRequest(request: Request): Promise<Response> {
  try {
    if (!isAgentAccessEnabled()) {
      return respond(503, -32003, 'Agent access is not available right now.', { reason: 'disabled' });
    }

    if (!isAllowedMcpOrigin(request)) {
      return respond(403, -32004, 'Browser requests from other sites are not allowed.', { reason: 'bad_origin' });
    }

    const leaked = tokensInQuery(new URL(request.url));
    if (leaked.length > 0) {
      // Each lookup is counted against the failed-auth budget first: past it, the database is not asked
      const ip = requestIp(request);
      // Only personal tokens cost budget: an OAuth token that passes its keyed check was genuinely issued
      const affordable = leaked.filter((token) => !token.startsWith('spl_pat_') || rateLimit(`mcp-auth-fail:${ip}`, FAILED_AUTH_PER_MINUTE, 60_000).allowed);
      const revoked = affordable.length > 0 && (await revokeLeakedTokens(request, affordable));
      return respond(401, -32001, revoked ? LEAKED_MESSAGE : LEAKED_UNKNOWN_MESSAGE, { reason: 'token_in_url' });
    }

    if (request.method !== 'POST') {
      return respond(405, -32000, 'Method not allowed. Send JSON-RPC requests with POST.', {
        reason: 'method_not_allowed',
        headers: { Allow: 'POST' },
      });
    }

    const ip = requestIp(request);
    const token = bearerToken(request);
    const oauthOn = isOAuthEnabled();

    let actor;
    if (token === null && oauthOn) {
      // A missing credential is how every first connection starts: never counted
      return oauthUnauthorized('missing');
    } else if (token === null) {
      return authFailure(ip, 'missing');
    } else if (token.startsWith('spl_oat_')) {
      if (!oauthOn) {
        return respond(503, -32003, OAUTH_DISABLED_MESSAGE, { reason: 'oauth_disabled', headers: { 'Retry-After': '60' } });
      }
      const resolved = await resolveOAuthAccessToken(token);
      if (!resolved.ok) {
        if (resolved.reason === 'unavailable') {
          return respond(503, -32003, UNAVAILABLE_MESSAGE, { reason: 'unavailable', headers: { 'Retry-After': '5' } });
        }
        return oauthUnauthorized(resolved.reason);
      }
      if (resolved.suspended) {
        // A 401 would make the client start a new sign-in, which would bypass the breaker
        const why = resolved.detail ? ` Why: ${resolved.detail}` : '';
        return respond(403, -32001, AUTH_MESSAGES.suspended + why, { reason: 'suspended' });
      }
      actor = resolved.actor;
    } else if (oauthOn && !token.startsWith('spl_pat_')) {
      // spl_ort_ (a refresh token) or anything else: not a credential here, and not counted
      return oauthUnauthorized('malformed');
    } else {
      // The v1 path, exactly. Shape is checked before any database call, inside resolveAgentToken
      const resolved = await resolveAgentToken(token);
      if (!resolved.ok) {
        if (resolved.reason === 'unavailable') {
          return respond(503, -32003, UNAVAILABLE_MESSAGE, { reason: 'unavailable', headers: { 'Retry-After': '5' } });
        }
        return authFailure(ip, resolved.reason, resolved.detail);
      }
      actor = resolved.actor;
    }

    await touchAgentToken(actor.tokenId, ip);

    // A limiter that could not be asked says nothing about the caller: 503, never 429
    const limit = await hitRateLimit(`mcp:${actor.tokenId}`, CALLS_PER_MINUTE, 60);
    if (limit.unavailable) {
      return respond(503, -32003, UNAVAILABLE_MESSAGE, { reason: 'unavailable', headers: { 'Retry-After': '5' } });
    }
    if (!limit.allowed) {
      return respond(429, -32002, 'Too many requests. This token may make 60 calls a minute.', {
        reason: 'rate_limited',
        headers: { 'Retry-After': String(Math.max(1, limit.retryAfter)) },
      });
    }

    const daily = await hitRateLimit(`mcp-day:${actor.userId}`, MCP_LIMITS.callsPerDay, 86400);
    if (daily.unavailable) {
      return respond(503, -32003, UNAVAILABLE_MESSAGE, { reason: 'unavailable', headers: { 'Retry-After': '5' } });
    }
    if (!daily.allowed) {
      return respond(429, -32002, 'The daily limit of calls for this account was reached. Try again tomorrow.', {
        reason: 'daily_limit',
        headers: { 'Retry-After': String(Math.max(1, daily.retryAfter)) },
      });
    }

    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;
    if (Array.isArray(parsed.body)) {
      return respond(400, -32600, 'Batches are not supported. Send one request at a time.', { reason: 'batch_not_supported' });
    }

    const response = await serveMcp(request, actor, ip, parsed.body);
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-store');
    headers.delete('set-cookie');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  } catch {
    console.error('mcp request failed');
    return respond(500, -32603, 'Internal error.', { reason: 'internal' });
  }
}
