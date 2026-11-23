import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { auditAgentCall, hitRateLimit, requestIp } from '@/lib/agent-access';
import { rateLimit } from '@/lib/rate-limit';
import { isOAuthEnabled, oauthIssuer } from '@/lib/oauth/config';
import { checkClientAndRedirect, MAX_STATE, validateAuthorize } from '@/lib/oauth/authorize';
import { bindingCookieName, bindingCookieOptions, htmlPage, NO_STORE, redirectToClient } from '@/lib/oauth/http';
import { hashOAuthSecret } from '@/lib/oauth/tokens';

const REQUEST_TTL_SECONDS = 600;
const IP_LIMIT = 20;
const USER_LIMIT = 10;
const WINDOW_SECONDS = 600;

/**
 * The authorization endpoint (docs/specs/mcp-oauth.md S4, A5, A14, A15).
 * Order: feature switch, client, redirect_uri (all three show our own page and
 * never redirect), then every other error redirects back to the client. On
 * success it stores the request, sets the binding cookie and sends the
 * browser to the consent page.
 */
export async function GET(request: NextRequest) {
  try {
    if (!isOAuthEnabled()) return htmlPage(404, 'Not found', 'This page does not exist.');

    const params = new URL(request.url).searchParams;

    const target = checkClientAndRedirect(params);
    if (!target.ok) {
      return htmlPage(
        400,
        'This sign-in link is not valid',
        target.reason === 'client'
          ? 'The app that sent you here is not one Splittr can connect to. Close this page and start again from Claude.'
          : 'The address this app asked to return to is not allowed. Close this page and start again from Claude.'
      );
    }
    const { client, redirectUri } = target;

    const state = params.get('state');
    const stateOut = state !== null && state.length <= MAX_STATE ? state : null;
    const refuse = (error: string, description: string) =>
      redirectToClient(redirectUri, { error, error_description: description, state: stateOut });

    const checked = validateAuthorize(params);
    if (!checked.ok) return refuse(checked.error.error, checked.error.description);
    const { codeChallenge, resource, scopes } = checked.value;

    // From here a request row is written: throttle by address, then by account
    const ip = requestIp(request);
    if (!rateLimit(`oauth-authorize:${ip}`, IP_LIMIT, WINDOW_SECONDS * 1000).allowed) {
      return refuse('temporarily_unavailable', 'Too many sign-in attempts. Try again in a few minutes.');
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const hit = await hitRateLimit(`oauth-authorize:user:${user.id}`, USER_LIMIT, WINDOW_SECONDS);
      if (!hit.allowed) return refuse('temporarily_unavailable', 'Too many sign-in attempts. Try again in a few minutes.');
    }

    const id = randomBytes(16).toString('base64url');
    const binding = randomBytes(32).toString('base64url');
    const now = Date.now();
    const { error } = await createAdminClient()
      .from('agent_oauth_requests')
      .insert({
        id,
        client_id: client.clientId,
        redirect_uri: redirectUri,
        state,
        code_challenge: codeChallenge,
        scopes_requested: scopes,
        resource,
        binding_hash: hashOAuthSecret(binding),
        user_id: user?.id ?? null,
        created_at: new Date(now).toISOString(),
        expires_at: new Date(now + REQUEST_TTL_SECONDS * 1000).toISOString(),
      });
    if (error) {
      console.error('oauth authorize insert failed:', error.code);
      return refuse('server_error', 'Splittr could not start the sign-in. Try again.');
    }

    await auditAgentCall({ tokenId: null, userId: user?.id ?? null, tool: 'oauth', outcome: 'request_created', ip });

    const response = new NextResponse(null, {
      status: 302,
      headers: { Location: `${oauthIssuer()}/oauth/consent/${id}`, ...NO_STORE },
    });
    response.cookies.set(bindingCookieName(id), binding, bindingCookieOptions(REQUEST_TTL_SECONDS));
    return response;
  } catch (error) {
    console.error('Error in oauth authorize:', error instanceof Error ? error.message : 'unknown');
    return htmlPage(500, 'Something went wrong', 'Close this page and start again from Claude.');
  }
}
