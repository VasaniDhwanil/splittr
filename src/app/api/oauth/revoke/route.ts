import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { auditAgentCall, requestIp } from '@/lib/agent-access';
import { agentPepper } from '@/lib/agent-tokens';
import { findClient } from '@/lib/oauth/clients';
import { isOAuthEnabled } from '@/lib/oauth/config';
import { afterGrantRevoked } from '@/lib/oauth/grants';
import { NO_STORE, readForm, temporarilyUnavailable, tokenError } from '@/lib/oauth/http';
import { overFailureLimit, recordFailure } from '@/lib/oauth/throttle';
import { hashOAuthSecret, parseOAuthToken } from '@/lib/oauth/tokens';

const ok = () => new NextResponse(null, { status: 200, headers: NO_STORE });

/**
 * RFC 7009 token revocation (docs/specs/mcp-oauth.md A11). Revoking either
 * token of a grant revokes the grant. An unknown, malformed or foreign token
 * is a 200 like any other, so the endpoint tells nobody anything. A database
 * error is a 503: Claude must not believe a revocation that did not happen.
 */
export async function POST(request: NextRequest) {
  const ip = requestIp(request);
  // As at the token endpoint: only a value that fails its shape or keyed check
  // counts against the address, and only such a request is refused over the limit
  const tooMany = () =>
    NextResponse.json(
      { error: 'temporarily_unavailable', error_description: 'Too many requests. Try again shortly.' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': '60' } }
    );
  const early = (response: NextResponse) => {
    if (overFailureLimit(ip)) return tooMany();
    recordFailure(ip);
    return response;
  };
  try {
    if (!isOAuthEnabled() || !agentPepper()) return temporarilyUnavailable();

    const form = await readForm(request);
    if (!form.ok) {
      return early(
        tokenError('invalid_request', form.reason === 'duplicate' ? 'A parameter was given more than once.' : 'Send application/x-www-form-urlencoded.')
      );
    }
    const { fields } = form;

    // The client is identified, never authenticated: any Authorization header is ignored
    const clientId = fields.get('client_id');
    if (!clientId) return early(tokenError('invalid_request', 'client_id is required.'));
    const client = findClient(clientId);
    if (!client) return early(tokenError('invalid_client', 'Unknown client.'));

    const value = fields.get('token');
    if (!value) return early(tokenError('invalid_request', 'token is required.'));

    // token_type_hint is only a hint: either type revokes the grant. Forged
    // or foreign strings never reach the database.
    if (parseOAuthToken(value) === null) {
      if (overFailureLimit(ip)) return tooMany();
      recordFailure(ip);
      await auditAgentCall({ tokenId: null, userId: null, tool: 'oauth', outcome: 'revoke_malformed', ip });
      return ok();
    }

    const { data, error } = await createAdminClient().rpc('oauth_revoke_by_token', {
      p_token_hash: hashOAuthSecret(value),
      p_client_id: client.clientId,
    });
    if (error || !data || typeof data.status !== 'string') return temporarilyUnavailable();

    if (data.status === 'revoked') {
      await afterGrantRevoked({ kind: 'revoked_by_client', grantId: data.grant_id, userId: data.user_id, grantName: client.label, ip });
      return ok();
    }
    if (data.status === 'not_found' || data.status === 'wrong_client') {
      await auditAgentCall({
        tokenId: data.status === 'wrong_client' ? data.grant_id : null,
        userId: data.status === 'wrong_client' ? data.user_id : null,
        tool: 'oauth',
        outcome: data.status === 'wrong_client' ? 'revoke_wrong_client' : 'revoke_not_found',
        ip,
      });
      return ok();
    }
    return temporarilyUnavailable();
  } catch (error) {
    console.error('Error in oauth revoke:', error instanceof Error ? error.message : 'unknown');
    return temporarilyUnavailable();
  }
}
