/**
 * What every consent API starts with: feature switch, same-site Origin (POST),
 * session, binding cookie, ownership, status and expiry
 * (docs/specs/mcp-oauth.md A5, A15, section 14). Anyone who is not the
 * request's owner, in the browser that started it, gets the same 404 (an
 * account switch in that browser takes the request over: see below).
 */
import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { auditAgentCall, isSameSiteOrigin, notFound, noStore, requestIp, type RouteUser } from '@/lib/agent-access';
import { findClient, type OAuthClient } from '@/lib/oauth/clients';
import { isOAuthEnabled } from '@/lib/oauth/config';
import { BINDING_COOKIE_SHAPE, bindingCookieName } from '@/lib/oauth/http';
import { hashOAuthSecret } from '@/lib/oauth/tokens';

export interface ConsentRequestRow {
  id: string;
  client_id: string;
  redirect_uri: string;
  state: string | null;
  scopes_requested: string[];
  resource: string;
  binding_hash: string;
  user_id: string | null;
  expires_at: string;
  status: string;
  code_hmac: string | null;
  code_expires_at: string | null;
  attempts: number;
  grant_id: string | null;
}

export type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface ConsentContext {
  user: RouteUser;
  supabase: Supabase;
  row: ConsentRequestRow;
  client: OAuthClient;
  /** The binding cookie's value, for the approve function. */
  binding: string;
}

const ID_SHAPE = /^[A-Za-z0-9_-]{22}$/;
const COLUMNS =
  'id, client_id, redirect_uri, state, scopes_requested, resource, binding_hash, user_id, expires_at, status, code_hmac, code_expires_at, attempts, grant_id';

const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export const unauthorized = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

/**
 * `expired: 'refuse'` answers 404 for an expired request; `'report'` hands it
 * back so approve can say `expired`.
 */
export async function guardConsent(
  request: NextRequest,
  id: string,
  opts: { post: boolean; expired?: 'refuse' | 'report' }
): Promise<{ response: NextResponse } | (ConsentContext & { expired: boolean })> {
  if (!isOAuthEnabled()) return { response: notFound() };
  if (opts.post && !isSameSiteOrigin(request)) {
    return { response: NextResponse.json({ error: 'Forbidden', code: 'bad_origin' }, { status: 403 }) };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { response: noStore(unauthorized()) };

  const cookie = request.cookies.get(bindingCookieName(id))?.value;
  if (!ID_SHAPE.test(id) || !cookie || !BINDING_COOKIE_SHAPE.test(cookie)) return { response: noStore(notFound()) };

  const db = createAdminClient();
  const read = () => db.from('agent_oauth_requests').select(COLUMNS).eq('id', id).maybeSingle();
  let { data: row, error } = await read();
  if (error) return { response: noStore(NextResponse.json({ error: 'Internal server error' }, { status: 500 })) };
  if (!row || !sameHash(row.binding_hash, hashOAuthSecret(cookie))) return { response: noStore(notFound()) };

  // The binding cookie proves this is the browser that started the request,
  // so the signed-in account may own it: the first account to present it
  // (usually /oauth/authorize already did this) or, for "Not you? Switch
  // account", a different one while nothing has been granted yet. Taking over
  // clears the emailed code, so a code sent to the previous account's inbox
  // can never approve for the new one. One compare-and-set on the owner seen:
  // of several accounts racing for the same request exactly one wins.
  const takeable = row.status === 'pending' && row.grant_id === null && new Date(row.expires_at).getTime() > Date.now();
  if (row.user_id !== user.id && takeable) {
    const previous = row.user_id;
    const claim = db
      .from('agent_oauth_requests')
      .update({ user_id: user.id, code_hmac: null, code_expires_at: null, attempts: 0 })
      .eq('id', id)
      .eq('status', 'pending')
      .is('grant_id', null);
    const { data: won, error: claimError } = await (previous === null ? claim.is('user_id', null) : claim.eq('user_id', previous)).select('id');
    if (claimError) return { response: noStore(NextResponse.json({ error: 'Internal server error' }, { status: 500 })) };
    if (won && won.length > 0) {
      // First claim: the audit row /oauth/authorize left out for a signed-out request
      const outcome = previous === null ? 'request_created' : 'consent_account_switched';
      await auditAgentCall({ tokenId: null, userId: user.id, tool: 'oauth', outcome, ip: requestIp(request) });
    }
    ({ data: row, error } = await read());
    if (error || !row) return { response: noStore(NextResponse.json({ error: 'Internal server error' }, { status: 500 })) };
  }
  if (row.user_id !== user.id || row.status !== 'pending') return { response: noStore(notFound()) };

  const expired = new Date(row.expires_at).getTime() <= Date.now();
  if (expired && opts.expired !== 'report') return { response: noStore(notFound()) };

  const client = findClient(row.client_id);
  if (!client) return { response: noStore(notFound()) };

  return { user: { id: user.id, email: user.email }, supabase, row: row as ConsentRequestRow, client, binding: cookie, expired };
}
