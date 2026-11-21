import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { agentPepper, parseScopes, type AgentScope } from '@/lib/agent-tokens';
import { auditAgentCall, noStore, requestIp } from '@/lib/agent-access';
import { buildOAuthConnectedEmail } from '@/lib/agent-emails';
import { sendEmail } from '@/lib/email';
import { destinationText } from '@/lib/oauth/clients';
import { oauthIssuer } from '@/lib/oauth/config';
import { guardConsent } from '@/lib/oauth/consent';
import { clientRedirectUrl } from '@/lib/oauth/http';
import { emailedCodeRequired, HOSTED_CLIENT_REQUIRES_EMAILED_CODE, hmacOAuthCode, readFreshSignIn } from '@/lib/oauth/stepup';
import { generateAuthorizationCode, hashOAuthSecret } from '@/lib/oauth/tokens';

interface ApproveResult {
  status: string;
  grant_id?: string;
  attempts_left?: number;
  locked_until?: string;
}

const fail = (error: string, code: string, status: number, extra: Record<string, unknown> = {}) =>
  noStore(NextResponse.json({ error, code, ...extra }, { status }));

/**
 * Approve: step-up, then one SQL function makes a PENDING grant and a code.
 * The grant gives no access until Claude redeems the code at the token endpoint.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardConsent(request, id, { post: true, expired: 'report' });
    if ('response' in guard) return guard.response;
    const { user, supabase, row, client, binding, expired } = guard;

    const pepper = agentPepper();
    if (!pepper) return noStore(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    if (expired) return fail('This request has expired. Start again from Claude.', 'expired', 400);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return fail('Invalid request body', 'invalid_input', 400);
    const scopes = parseScopes(body.scopes);
    if (!scopes || !scopes.includes('read')) return fail('Choose the scopes to grant; read is always included.', 'invalid_input', 400);
    if (body.replace !== undefined && typeof body.replace !== 'boolean') return fail('replace must be true or false', 'invalid_input', 400);
    if (body.code !== undefined && typeof body.code !== 'string') return fail('code must be a string', 'invalid_input', 400);

    // The hosted client always needs the emailed code; otherwise a fresh email sign-in is enough
    const hostedAlwaysCoded = client.destination === 'claude.ai' && HOSTED_CLIENT_REQUIRES_EMAILED_CODE;
    const fresh = hostedAlwaysCoded ? false : await readFreshSignIn(supabase, user.id);
    const requireCode = emailedCodeRequired(client, fresh);

    // Anything that is not the code still costs an attempt (it can never match)
    const typed = typeof body.code === 'string' ? body.code.trim().slice(0, 32) : '';
    const code_hmac = requireCode && typed !== '' ? hmacOAuthCode(pepper, user.id, row.id, typed) : null;

    const authCode = generateAuthorizationCode();
    const revokeSecret = randomBytes(32).toString('base64url');

    const { data, error } = await createAdminClient().rpc('oauth_approve_request', {
      p_request_id: row.id,
      p_user_id: user.id,
      p_binding_hash: hashOAuthSecret(binding),
      p_scopes: scopes,
      p_replace: body.replace === true,
      p_require_code: requireCode,
      p_code_hmac: code_hmac,
      p_code_hash: hashOAuthSecret(authCode),
      p_grant_name: client.label,
      p_destination: client.destination,
      p_revoke_link_hash: hashOAuthSecret(revokeSecret),
    });
    if (error || !data) {
      console.error('oauth_approve_request failed:', error?.code);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
    const result = data as ApproveResult;

    switch (result.status) {
      case 'ok':
        break;
      case 'wrong_code':
        return fail('That code is not right.', 'wrong_code', 400, { attempts_left: result.attempts_left ?? 0 });
      case 'code_required':
        return fail('Enter the code we emailed you. Request a new one if it expired.', 'code_required', 400);
      case 'too_many_attempts':
        return fail('Too many wrong attempts. Request a new code.', 'code_required', 400, { attempts_left: 0 });
      case 'expired':
        return fail('This request has expired. Start again from Claude.', 'expired', 400);
      case 'invalid_input':
        return fail('Choose the scopes to grant; read is always included.', 'invalid_input', 400);
      case 'grant_limit':
        return fail('You already have 5 connections. Disconnect one first.', 'grant_limit', 409);
      case 'locked': {
        const until = result.locked_until ? new Date(result.locked_until).getTime() : Date.now() + 86_400_000;
        const retry_after = Math.max(1, Math.ceil((until - Date.now()) / 1000));
        return noStore(
          NextResponse.json(
            { error: 'Connecting is paused after too many wrong codes. Signing in again unlocks it.', code: 'locked', retry_after },
            { status: 429, headers: { 'Retry-After': String(retry_after) } }
          )
        );
      }
      case 'not_found':
        return noStore(NextResponse.json({ error: 'Not found' }, { status: 404 }));
      default:
        console.error('oauth_approve_request returned an unexpected status');
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    const ip = requestIp(request);
    await auditAgentCall({ tokenId: result.grant_id ?? null, userId: user.id, tool: 'oauth', outcome: 'approved', ip });

    // Sent BEFORE answering, so an approval someone else triggered is in the inbox
    // by the time Claude holds a code. A failed send does not undo the approval.
    if (user.email) {
      try {
        const email = buildOAuthConnectedEmail({
          clientLabel: client.label,
          destination: destinationText(client),
          accountEmail: user.email,
          scopes: scopes as AgentScope[],
          ip,
          revokeUrl: `${oauthIssuer()}/agent-tokens/revoke?s=${revokeSecret}`,
        });
        await sendEmail({ to: user.email, ...email });
      } catch {
        // ignored by design
      }
    }

    return noStore(NextResponse.json({ redirect_url: clientRedirectUrl(row.redirect_uri, { code: authCode, state: row.state }) }));
  } catch (error) {
    console.error('Error in oauth consent approve:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
