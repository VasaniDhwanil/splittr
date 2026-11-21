import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { agentPepper, generateEmailCode } from '@/lib/agent-tokens';
import { hitRateLimit, noStore, requestIp } from '@/lib/agent-access';
import { buildOAuthConsentCodeEmail } from '@/lib/agent-emails';
import { isEmailConfigured, sendEmail } from '@/lib/email';
import { destinationText } from '@/lib/oauth/clients';
import { guardConsent } from '@/lib/oauth/consent';
import { CODE_TTL_MINUTES, hmacOAuthCode } from '@/lib/oauth/stepup';
import type { AgentScope } from '@/lib/agent-tokens';

/** Sends the 6-digit code that proves inbox control. 3 per account per hour. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardConsent(request, id, { post: true });
    if ('response' in guard) return guard.response;
    const { user, row, client } = guard;

    const pepper = agentPepper();
    if (!pepper) return noStore(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    if (!user.email) {
      return noStore(NextResponse.json({ error: 'Your account has no email address to send the code to', code: 'email_unavailable' }, { status: 503 }));
    }

    const db = createAdminClient();

    const { data: state } = await db.from('agent_mint_state').select('locked_until').eq('user_id', user.id).maybeSingle();
    if (state?.locked_until && new Date(state.locked_until).getTime() > Date.now()) {
      const retry_after = Math.ceil((new Date(state.locked_until).getTime() - Date.now()) / 1000);
      return noStore(
        NextResponse.json(
          { error: 'Too many wrong codes. Connecting is paused; signing in again unlocks it.', code: 'locked', retry_after },
          { status: 429, headers: { 'Retry-After': String(retry_after) } }
        )
      );
    }

    const hit = await hitRateLimit(`oauth_code:hour:${user.id}`, 3, 3600);
    if (!hit.allowed) {
      return noStore(
        NextResponse.json(
          { error: 'Too many code requests. Try again later.', code: 'rate_limited', retry_after: hit.retryAfter },
          { status: 429, headers: { 'Retry-After': String(hit.retryAfter) } }
        )
      );
    }

    // Without Resend the only place the code can go is the dev console
    const devConsole = !isEmailConfigured() && process.env.NODE_ENV === 'development';
    if (!isEmailConfigured() && !devConsole) {
      return noStore(NextResponse.json({ error: 'Email is unavailable right now. Try again later.', code: 'email_unavailable' }, { status: 503 }));
    }

    const code = generateEmailCode();
    const code_hmac = hmacOAuthCode(pepper, user.id, row.id, code);
    const code_expires_at = new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString();

    // A new code replaces the old one and resets its attempts
    const { data: updated, error } = await db
      .from('agent_oauth_requests')
      .update({ code_hmac, code_expires_at, attempts: 0 })
      .eq('id', row.id)
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .select('id');
    if (error || !updated || updated.length === 0) {
      return noStore(NextResponse.json({ error: error ? 'Internal server error' : 'Not found' }, { status: error ? 500 : 404 }));
    }

    let sent = devConsole;
    if (devConsole) {
      console.log(`[dev only] OAuth consent code for ${user.email}: ${code}`);
    } else {
      const scopes: AgentScope[] = row.scopes_requested.includes('read') ? (row.scopes_requested as AgentScope[]) : ['read', ...(row.scopes_requested as AgentScope[])];
      const email = buildOAuthConsentCodeEmail({
        destination: destinationText(client),
        accountEmail: user.email,
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
      await db.from('agent_oauth_requests').update({ code_hmac: null, code_expires_at: null }).eq('id', row.id).eq('code_hmac', code_hmac);
      return noStore(NextResponse.json({ error: 'Could not send the code. Try again later.', code: 'email_unavailable' }, { status: 503 }));
    }

    return noStore(NextResponse.json({ code_expires_at }));
  } catch (error) {
    console.error('Error in oauth consent code:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
