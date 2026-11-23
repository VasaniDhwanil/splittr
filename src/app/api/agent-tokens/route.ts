import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  agentPepper,
  CODE_TTL_MINUTES,
  generateEmailCode,
  hmacEmailCode,
  isAgentAccessEnabled,
  MAX_ACTIVE_TOKENS,
  MAX_TOKEN_NAME,
  parseScopes,
  TOKEN_EXPIRY_DAYS,
} from '@/lib/agent-tokens';
import { guardAgentSession, hitRateLimit, requestIp } from '@/lib/agent-access';
import { buildAgentCodeEmail } from '@/lib/agent-emails';
import { isEmailConfigured, sendEmail } from '@/lib/email';
import { cleanText } from '@/lib/validate';
import { CANONICAL_ORIGIN } from '@/lib/site-origin';

const LIST_WINDOW_MS = 30 * 24 * 3600 * 1000;

type TokenStatus = 'active' | 'suspended' | 'expired' | 'revoked';

function statusOf(row: { revoked_at: string | null; suspended_at: string | null; expires_at: string }): TokenStatus {
  if (row.revoked_at) return 'revoked';
  if (row.suspended_at) return 'suspended';
  if (new Date(row.expires_at).getTime() <= Date.now()) return 'expired';
  return 'active';
}

export async function GET() {
  try {
    const mcp_url = `${CANONICAL_ORIGIN}/api/mcp`;
    if (!isAgentAccessEnabled()) {
      return NextResponse.json({ enabled: false, mcp_url, tokens: [] });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Active tokens, plus revoked or expired ones for 30 days
    const cutoff = new Date(Date.now() - LIST_WINDOW_MS).toISOString();
    const BASE_COLUMNS =
      'id, name, last4, scopes, created_at, expires_at, last_used_at, last_used_ip, suspended_at, suspended_reason, revoked_at, revoked_reason';
    const db = createAdminClient();
    const list = (columns: string) =>
      db
        .from('agent_tokens')
        .select(columns)
        .eq('user_id', user.id)
        .or(`and(revoked_at.is.null,expires_at.gt.${cutoff}),revoked_at.gt.${cutoff}`)
        .order('created_at', { ascending: false });
    // Before migration 019 there is no kind column (42703): everything is a personal token
    let result = await list(`${BASE_COLUMNS}, kind, oauth_destination, oauth_status`);
    if (result.error?.code === '42703') result = await list(BASE_COLUMNS);
    const { error } = result;
    if (error) {
      console.error('agent-tokens list failed:', error.code);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    type Row = {
      id: string;
      name: string;
      last4: string | null;
      scopes: string[];
      created_at: string;
      expires_at: string;
      last_used_at: string | null;
      last_used_ip: string | null;
      suspended_at: string | null;
      suspended_reason: string | null;
      revoked_at: string | null;
      revoked_reason: string | null;
      kind?: 'pat' | 'oauth';
      oauth_destination?: 'claude.ai' | 'loopback' | null;
      oauth_status?: 'pending' | 'live' | null;
    };
    const tokens = ((result.data ?? []) as unknown as Row[])
      // A grant that was approved but never redeemed is not a connection yet (it never will be once its code expires)
      .filter((row) => row.oauth_status !== 'pending')
      .map((row) => ({
        id: row.id,
        name: row.name,
        kind: row.kind ?? 'pat',
        ...(row.kind === 'oauth' ? { destination: row.oauth_destination } : {}),
        last4: row.kind === 'oauth' ? null : row.last4,
        scopes: row.scopes,
        created_at: row.created_at,
        expires_at: row.expires_at,
        last_used_at: row.last_used_at,
        last_used_ip: row.last_used_ip,
        status: statusOf(row),
        suspended_reason: row.suspended_reason,
        revoked_reason: row.revoked_reason,
      }));
    return NextResponse.json({ enabled: true, mcp_url, tokens }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Error in agent-tokens GET:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

const invalid = (error: string) => NextResponse.json({ error, code: 'invalid_input' }, { status: 400 });

export async function POST(request: NextRequest) {
  try {
    const guard = await guardAgentSession(request);
    if ('response' in guard) return guard.response;
    const { user } = guard;

    const pepper = agentPepper();
    if (!pepper) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return invalid('Invalid request body');

    const name = cleanText(body.name, MAX_TOKEN_NAME + 1);
    if (!name || name.length > MAX_TOKEN_NAME) return invalid(`Name must be 1 to ${MAX_TOKEN_NAME} characters`);
    const scopes = parseScopes(body.scopes);
    if (!scopes) return invalid('Choose at least one valid scope');
    const days = body.expires_in_days;
    if (!(TOKEN_EXPIRY_DAYS as readonly unknown[]).includes(days)) return invalid('Expiry must be 7, 30 or 90 days');

    if (!user.email) {
      return NextResponse.json({ error: 'Your account has no email address to send the code to', code: 'email_unavailable' }, { status: 503 });
    }

    const db = createAdminClient();

    const { data: state } = await db
      .from('agent_mint_state')
      .select('locked_until')
      .eq('user_id', user.id)
      .maybeSingle();
    if (state?.locked_until && new Date(state.locked_until).getTime() > Date.now()) {
      const retry_after = Math.ceil((new Date(state.locked_until).getTime() - Date.now()) / 1000);
      return NextResponse.json(
        { error: 'Too many wrong codes. Token creation is paused; signing in again unlocks it.', code: 'locked', retry_after },
        { status: 429, headers: { 'Retry-After': String(retry_after) } }
      );
    }

    // Only personal tokens count: OAuth grants have their own cap (migration
    // 019). Before 019 the column does not exist (42703): everything is personal.
    const countActive = (personalOnly: boolean) => {
      const query = db
        .from('agent_tokens')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .is('revoked_at', null)
        .gt('expires_at', new Date().toISOString());
      return personalOnly ? query.eq('kind', 'pat') : query;
    };
    let { count: active, error: countError } = await countActive(true);
    if (countError?.code === '42703') ({ count: active, error: countError } = await countActive(false));
    if (countError) {
      console.error('agent-tokens count failed:', countError.code);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
    if ((active ?? 0) >= MAX_ACTIVE_TOKENS) {
      return NextResponse.json(
        { error: `You already have ${MAX_ACTIVE_TOKENS} active tokens. Revoke one first.`, code: 'token_limit' },
        { status: 409 }
      );
    }

    for (const [window, limit, seconds] of [
      ['hour', 3, 3600],
      ['day', 10, 86400],
    ] as const) {
      const hit = await hitRateLimit(`agent_code:${window}:${user.id}`, limit, seconds);
      if (!hit.allowed) {
        return NextResponse.json(
          { error: 'Too many code requests. Try again later.', code: 'rate_limited', retry_after: hit.retryAfter },
          { status: 429, headers: { 'Retry-After': String(hit.retryAfter) } }
        );
      }
    }

    // Without Resend the only place the code can go is the dev console
    const devConsole = !isEmailConfigured() && process.env.NODE_ENV === 'development';
    if (!isEmailConfigured() && !devConsole) {
      return NextResponse.json({ error: 'Email is unavailable right now. Try again later.', code: 'email_unavailable' }, { status: 503 });
    }

    const code = generateEmailCode();
    const code_hmac = hmacEmailCode(pepper, user.id, code);
    const now = Date.now();
    const code_expires_at = new Date(now + CODE_TTL_MINUTES * 60_000).toISOString();

    const { error: upsertError } = await db.from('agent_token_pending').upsert({
      user_id: user.id,
      name,
      scopes,
      expires_in_days: days,
      code_hmac,
      attempts: 0,
      created_at: new Date(now).toISOString(),
      expires_at: code_expires_at,
      consumed_at: null,
    });
    if (upsertError) {
      console.error('agent-tokens pending upsert failed:', upsertError.code);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    let sent = devConsole;
    if (devConsole) {
      console.log(`[dev only] agent token code for ${user.email}: ${code}`);
    } else {
      const email = buildAgentCodeEmail({
        tokenName: name,
        scopes,
        code,
        ip: requestIp(request),
        minutes: CODE_TTL_MINUTES,
      });
      const result = await sendEmail({ to: user.email, ...email }).catch(() => ({ ok: false }));
      sent = result.ok;
    }

    if (!sent) {
      // A code nobody received must not stay redeemable
      await db.from('agent_token_pending').delete().eq('user_id', user.id).eq('code_hmac', code_hmac);
      return NextResponse.json({ error: 'Could not send the code. Try again later.', code: 'email_unavailable' }, { status: 503 });
    }

    return NextResponse.json({ ok: true, code_expires_at }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Error in agent-tokens POST:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
