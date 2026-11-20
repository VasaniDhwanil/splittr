import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { agentPepper, generateAgentToken, hashAgentToken, hmacEmailCode } from '@/lib/agent-tokens';
import { guardAgentSession, noStore, requestIp } from '@/lib/agent-access';
import { buildAgentTokenCreatedEmail } from '@/lib/agent-emails';
import { sendEmail } from '@/lib/email';
import { siteOrigin } from '@/lib/site-origin';
import type { AgentScope } from '@/lib/agent-tokens';

interface MintResult {
  status: string;
  attempts_left?: number;
  locked_until?: string;
  id?: string;
  name?: string;
  scopes?: AgentScope[];
  expires_at?: string;
}

const fail = (error: string, code: string, status: number, extra: Record<string, unknown> = {}) =>
  noStore(NextResponse.json({ error, code, ...extra }, { status }));

export async function POST(request: NextRequest) {
  try {
    const guard = await guardAgentSession(request);
    if ('response' in guard) return guard.response;
    const { user } = guard;

    const pepper = agentPepper();
    if (!pepper) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body', code: 'invalid_input' }, { status: 400 });
    }
    // Anything that is not six digits can never match; it still costs an attempt
    const code = typeof body.code === 'string' ? body.code.trim().slice(0, 32) : '';

    const minted = generateAgentToken();
    const revokeSecret = randomBytes(32).toString('base64url');

    const { data, error } = await createAdminClient().rpc('mint_agent_token', {
      p_user_id: user.id,
      p_code_hmac: hmacEmailCode(pepper, user.id, code),
      p_token_hash: minted.hash,
      p_last4: minted.last4,
      p_revoke_link_hash: hashAgentToken(revokeSecret),
    });
    if (error || !data) {
      console.error('mint_agent_token failed:', error?.code);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
    const result = data as MintResult;

    switch (result.status) {
      case 'ok':
        break;
      case 'wrong_code':
        return fail('That code is not right.', 'wrong_code', 400, { attempts_left: result.attempts_left ?? 0 });
      case 'expired':
        return fail('That code has expired. Request a new one.', 'expired', 400);
      case 'no_pending':
        return fail('There is no code waiting. Request a new one.', 'no_pending', 400);
      case 'too_many_attempts':
        return fail('Too many wrong attempts. Request a new code.', 'too_many_attempts', 400);
      case 'token_limit':
        return fail('You already have 5 active tokens. Revoke one first.', 'token_limit', 409);
      case 'locked': {
        const until = result.locked_until ? new Date(result.locked_until).getTime() : Date.now() + 86_400_000;
        const retry_after = Math.max(1, Math.ceil((until - Date.now()) / 1000));
        return noStore(
          NextResponse.json(
            { error: 'Token creation is paused after too many wrong codes. Signing in again unlocks it.', code: 'locked', retry_after },
            { status: 429, headers: { 'Retry-After': String(retry_after) } }
          )
        );
      }
      default:
        console.error('mint_agent_token returned an unexpected status');
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    // Best effort: the token exists whether or not this notice goes out
    if (user.email) {
      try {
        const email = buildAgentTokenCreatedEmail({
          tokenName: result.name ?? '',
          scopes: result.scopes ?? [],
          ip: requestIp(request),
          revokeUrl: `${siteOrigin(request)}/agent-tokens/revoke?s=${revokeSecret}`,
        });
        await sendEmail({ to: user.email, ...email });
      } catch {
        // ignored by design
      }
    }

    return noStore(
      NextResponse.json({
        token: minted.token,
        id: result.id,
        name: result.name,
        scopes: result.scopes,
        last4: minted.last4,
        expires_at: result.expires_at,
      })
    );
  } catch (error) {
    console.error('Error in agent-tokens verify:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
