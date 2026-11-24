/**
 * Server-side plumbing for agent access: resolving a token to an Actor, the
 * shared rate limiter, the audit log, and the guards the token routes share.
 * Service-role only; NEVER import this from a client component.
 *
 * Nothing here logs or returns a plaintext token or emailed code.
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { hashAgentToken, isAgentAccessEnabled, isWellFormedAgentToken, type AgentScope } from '@/lib/agent-tokens';
import { ALLOWED_ORIGINS } from '@/lib/site-origin';

/** Who is calling: an account, acting through one of its tokens. */
export interface Actor {
  userId: string;
  tokenId: string;
  scopes: AgentScope[];
}

export type ResolveFailure = 'malformed' | 'unknown' | 'expired' | 'revoked' | 'suspended' | 'unavailable';
export type ResolveResult =
  | { ok: true; actor: Actor }
  | { ok: false; reason: ResolveFailure; /** Why a suspended token was paused. */ detail?: string };

/** 'unavailable' means the database could not answer: the token may well be fine. */

/** A malformed value is rejected before any database call. */
export async function resolveAgentToken(token: unknown): Promise<ResolveResult> {
  if (!isWellFormedAgentToken(token)) return { ok: false, reason: 'malformed' };

  const { data, error } = await createAdminClient()
    .from('agent_tokens')
    .select('id, user_id, scopes, expires_at, revoked_at, suspended_at, suspended_reason')
    .eq('token_hash', hashAgentToken(token))
    .maybeSingle();
  if (error) return { ok: false, reason: 'unavailable' };
  if (!data) return { ok: false, reason: 'unknown' };

  if (data.revoked_at) return { ok: false, reason: 'revoked' };
  if (data.suspended_at) return { ok: false, reason: 'suspended', detail: data.suspended_reason ?? undefined };
  if (new Date(data.expires_at).getTime() <= Date.now()) return { ok: false, reason: 'expired' };
  return { ok: true, actor: { userId: data.user_id, tokenId: data.id, scopes: data.scopes as AgentScope[] } };
}

export interface RateLimitHit {
  allowed: boolean;
  /** Seconds until the window resets. */
  retryAfter: number;
  /** True when the answer is "no" only because the database could not be asked. */
  unavailable?: boolean;
}

/** Counts one hit. If the database can't say, the answer is no. */
export async function hitRateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitHit> {
  try {
    const { data, error } = await createAdminClient().rpc('agent_rate_limit', {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error || !data || typeof data.allowed !== 'boolean') return { allowed: false, retryAfter: windowSeconds, unavailable: true };
    return { allowed: data.allowed, retryAfter: Number(data.retry_after) || windowSeconds };
  } catch {
    return { allowed: false, retryAfter: windowSeconds, unavailable: true };
  }
}

/** Best effort: a failed audit write never fails the call it describes. */
export async function auditAgentCall(entry: {
  tokenId: string | null;
  userId: string | null;
  tool: string;
  outcome: string;
  ip?: string | null;
}): Promise<void> {
  try {
    await createAdminClient().from('agent_audit_log').insert({
      token_id: entry.tokenId,
      user_id: entry.userId,
      tool: entry.tool,
      outcome: entry.outcome,
      ip: entry.ip ?? null,
    });
  } catch {
    // ignored by design
  }
}

/** Records last use, at most one write a minute per token. */
export async function touchAgentToken(tokenId: string, ip: string): Promise<void> {
  try {
    const stale = new Date(Date.now() - 60_000).toISOString();
    await createAdminClient()
      .from('agent_tokens')
      .update({ last_used_at: new Date().toISOString(), last_used_ip: ip })
      .eq('id', tokenId)
      .or(`last_used_at.is.null,last_used_at.lt.${stale}`);
  } catch {
    // ignored by design
  }
}

/** Approximate client address: Vercel's x-real-ip, never the spoofable forwarded chain. */
export function requestIp(request: Request): string {
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

const isLocalOrigin = (origin: string) => {
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
};

/**
 * The browser's Origin must be this site: the request's own origin, or one of
 * the site's known origins. ALLOWED_ORIGINS also lists localhost for the
 * sign-in handoff; that entry only counts outside production. A missing
 * Origin is refused: browsers always send it on these requests.
 */
export function isSameSiteOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  if (origin === new URL(request.url).origin) return true;
  if (!ALLOWED_ORIGINS.has(origin)) return false;
  return !isLocalOrigin(origin) || process.env.NODE_ENV !== 'production';
}

export function noStore(res: NextResponse): NextResponse {
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

export const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 });

export interface RouteUser {
  id: string;
  email: string | undefined;
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Feature switch (404), then same-site Origin (403). */
export function guardAgentOrigin(request: Request): NextResponse | null {
  if (!isAgentAccessEnabled()) return notFound();
  if (!isSameSiteOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden', code: 'bad_origin' }, { status: 403 });
  }
  return null;
}

/**
 * What every signed-in token route starts with, in order: feature switch
 * (404), same-site Origin (403), session (401).
 */
export async function guardAgentSession(
  request: Request,
  { requireOrigin = true }: { requireOrigin?: boolean } = {}
): Promise<{ response: NextResponse } | { user: RouteUser; supabase: Supabase }> {
  // Reads change nothing, so they skip the Origin check; the switch always applies
  const refused = requireOrigin ? guardAgentOrigin(request) : isAgentAccessEnabled() ? null : notFound();
  if (refused) return { response: refused };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  return { user: { id: user.id, email: user.email }, supabase };
}

/** Delete the account's wrong-code lock. Best effort: the table may not exist yet. */
export async function clearMintLock(userId: string): Promise<boolean> {
  try {
    const { error } = await createAdminClient().from('agent_mint_state').delete().eq('user_id', userId);
    return !error;
  } catch {
    return false;
  }
}

/**
 * Revokes every unrevoked token (personal and OAuth) of an account in one
 * step, under the account's advisory lock (migration 019's
 * revoke_account_agent_tokens). Before that migration the function does not
 * exist: fall back to the plain update, which is all there was to deadlock
 * with then (no OAuth redemptions).
 */
export async function revokeAccountTokens(
  userId: string,
  reason: string,
  includeExpired: boolean
): Promise<{ ids: string[] } | { error: string | undefined }> {
  const db = createAdminClient();
  const { data, error } = await db.rpc('revoke_account_agent_tokens', {
    p_user_id: userId,
    p_reason: reason,
    p_include_expired: includeExpired,
  });
  if (!error) return { ids: (data ?? []) as string[] };
  if (error.code !== 'PGRST202' && error.code !== '42883') return { error: error.code };

  const now = new Date().toISOString();
  let query = db.from('agent_tokens').update({ revoked_at: now, revoked_reason: reason }).eq('user_id', userId).is('revoked_at', null);
  if (!includeExpired) query = query.gt('expires_at', now);
  const { data: rows, error: updateError } = await query.select('id');
  if (updateError) return { error: updateError.code };
  return { ids: (rows ?? []).map((row) => row.id as string) };
}
