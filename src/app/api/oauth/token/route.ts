import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { auditAgentCall, hitRateLimit, requestIp } from '@/lib/agent-access';
import { agentPepper } from '@/lib/agent-tokens';
import { findClient } from '@/lib/oauth/clients';
import { canonicalResource } from '@/lib/oauth/authorize';
import { isOAuthEnabled } from '@/lib/oauth/config';
import { afterGrantRevoked } from '@/lib/oauth/grants';
import { NO_STORE, readForm, temporarilyUnavailable, tokenError } from '@/lib/oauth/http';
import { overFailureLimit, recordFailure } from '@/lib/oauth/throttle';
import {
  PKCE_VERIFIER_RE,
  deriveSuccessors,
  generateOAuthTokenPair,
  hashOAuthSecret,
  isWellFormedAuthorizationCode,
  parseOAuthToken,
  verifyPkceS256,
} from '@/lib/oauth/tokens';

const ACCESS_TOKEN_SECONDS = 3600;
const PER_GRANT_PER_MINUTE = 60;

const tooManyRequests = (retryAfter: number) =>
  NextResponse.json(
    { error: 'temporarily_unavailable', error_description: 'Too many requests. Try again shortly.' },
    { status: 429, headers: { ...NO_STORE, 'Retry-After': String(retryAfter) } }
  );

function tokenResponse(pair: { access: string; refresh: string }, scopes: string[]) {
  return NextResponse.json(
    {
      access_token: pair.access,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_SECONDS,
      refresh_token: pair.refresh,
      scope: scopes.join(' '),
    },
    { headers: NO_STORE }
  );
}

/**
 * The token endpoint (docs/specs/mcp-oauth.md S6 as amended by A1, A3, A12,
 * A14, A17). Public clients only: an Authorization header or client_secret is
 * ignored. A database error is ALWAYS a 503 with Retry-After, never
 * invalid_grant: Claude treats invalid_grant as "this connection is dead".
 */
export async function POST(request: NextRequest) {
  const ip = requestIp(request);
  // Failures before a grant is known count against the address
  const early = (response: NextResponse) => {
    recordFailure(ip);
    return response;
  };
  try {
    if (!isOAuthEnabled() || !agentPepper()) return temporarilyUnavailable();
    if (overFailureLimit(ip)) return tooManyRequests(60);

    const form = await readForm(request);
    if (!form.ok) {
      return early(
        tokenError(
          'invalid_request',
          form.reason === 'content_type'
            ? 'Send application/x-www-form-urlencoded.'
            : form.reason === 'duplicate'
              ? 'A parameter was given more than once.'
              : 'The request body could not be read.'
        )
      );
    }
    const { fields } = form;

    const clientId = fields.get('client_id');
    if (!clientId) return early(tokenError('invalid_request', 'client_id is required.'));
    const client = findClient(clientId);
    if (!client) return early(tokenError('invalid_client', 'Unknown client.'));

    const grantType = fields.get('grant_type');
    if (!grantType) return early(tokenError('invalid_request', 'grant_type is required.'));
    if (grantType !== 'authorization_code' && grantType !== 'refresh_token') {
      return early(tokenError('unsupported_grant_type', 'Only authorization_code and refresh_token are supported.'));
    }

    const rawResource = fields.get('resource');
    if (rawResource !== undefined && canonicalResource(rawResource) === null) {
      return early(tokenError('invalid_target', 'The resource is not served by this authorization server.'));
    }

    const db = createAdminClient();

    // ---------------------------------------------------------------- code
    if (grantType === 'authorization_code') {
      const code = fields.get('code');
      const verifier = fields.get('code_verifier');
      if (!code) return early(tokenError('invalid_request', 'code is required.'));
      if (!verifier) return early(tokenError('invalid_request', 'code_verifier is required.'));
      if (!isWellFormedAuthorizationCode(code) || !PKCE_VERIFIER_RE.test(verifier)) {
        return early(tokenError('invalid_grant', 'The code or code_verifier is not valid.'));
      }
      const redirectUri = fields.get('redirect_uri');
      const codeHash = hashOAuthSecret(code);

      const { data: row, error } = await db
        .from('agent_oauth_codes')
        .select('grant_id, client_id, redirect_uri, code_challenge')
        .eq('hash', codeHash)
        .maybeSingle();
      if (error) return temporarilyUnavailable();
      if (!row) return early(tokenError('invalid_grant', 'The code is not valid.'));

      const hit = await hitRateLimit(`oauth-token:grant:${row.grant_id}`, PER_GRANT_PER_MINUTE, 60);
      if (hit.unavailable) return temporarilyUnavailable();
      if (!hit.allowed) return tooManyRequests(hit.retryAfter);

      // Every binding is compared, and only then reported, so which one failed is not an oracle
      const clientOk = row.client_id === client.clientId;
      const redirectOk = redirectUri === undefined || redirectUri === row.redirect_uri;
      const verifierOk = verifyPkceS256(verifier, row.code_challenge);
      const bindingsOk = clientOk && redirectOk && verifierOk;

      const pair = generateOAuthTokenPair();
      const { data, error: rpcError } = await db.rpc('oauth_redeem_code', {
        p_code_hash: codeHash,
        p_bindings_ok: bindingsOk,
        p_access_hash: hashOAuthSecret(pair.access),
        p_refresh_hash: hashOAuthSecret(pair.refresh),
      });
      if (rpcError || !data || typeof data.status !== 'string') return temporarilyUnavailable();

      switch (data.status) {
        case 'ok':
          await auditAgentCall({ tokenId: data.grant_id, userId: data.user_id, tool: 'oauth', outcome: 'exchange', ip });
          return tokenResponse(pair, data.scopes as string[]);
        case 'replayed':
          await afterGrantRevoked({
            kind: 'code_replay_revoked',
            grantId: data.grant_id,
            userId: data.user_id,
            grantName: client.label,
            ip,
          });
          return tokenError('invalid_grant', 'The code was already used.');
        case 'grant_limit':
          await auditAgentCall({ tokenId: data.grant_id, userId: data.user_id, tool: 'oauth', outcome: 'grant_limit', ip });
          return tokenError('invalid_grant', 'The code is not valid.');
        case 'invalid':
        case 'expired':
        case 'not_found':
          return tokenError('invalid_grant', 'The code is not valid.');
        default:
          return temporarilyUnavailable();
      }
    }

    // ------------------------------------------------------------- refresh
    const refreshToken = fields.get('refresh_token');
    if (!refreshToken) return early(tokenError('invalid_request', 'refresh_token is required.'));
    // An access token or a personal token here is simply not a refresh token
    if (parseOAuthToken(refreshToken) !== 'refresh') return early(tokenError('invalid_grant', 'The refresh token is not valid.'));
    const refreshHash = hashOAuthSecret(refreshToken);

    const { data: row, error } = await db
      .from('agent_oauth_tokens')
      .select('grant_id')
      .eq('hash', refreshHash)
      .eq('type', 'refresh')
      .maybeSingle();
    if (error) return temporarilyUnavailable();
    if (!row) return early(tokenError('invalid_grant', 'The refresh token is not valid.'));

    const hit = await hitRateLimit(`oauth-token:grant:${row.grant_id}`, PER_GRANT_PER_MINUTE, 60);
    if (hit.unavailable) return temporarilyUnavailable();
    if (!hit.allowed) return tooManyRequests(hit.retryAfter);

    const next = deriveSuccessors(refreshToken);
    const { data, error: rpcError } = await db.rpc('oauth_refresh', {
      p_refresh_hash: refreshHash,
      p_client_id: client.clientId,
      p_new_access_hash: hashOAuthSecret(next.access),
      p_new_refresh_hash: hashOAuthSecret(next.refresh),
    });
    if (rpcError || !data || typeof data.status !== 'string') return temporarilyUnavailable();

    switch (data.status) {
      case 'ok':
        await auditAgentCall({
          tokenId: data.grant_id,
          userId: data.user_id,
          tool: 'oauth',
          outcome: data.replay ? 'refresh_replay' : 'refresh',
          ip,
        });
        return tokenResponse(next, data.scopes as string[]);
      case 'reuse':
        await afterGrantRevoked({
          kind: 'refresh_reuse_revoked',
          grantId: data.grant_id,
          userId: data.user_id,
          grantName: client.label,
          ip,
        });
        return tokenError('invalid_grant', 'The refresh token was already used.');
      case 'not_found':
      case 'revoked':
      case 'expired':
      case 'client_mismatch':
        return tokenError('invalid_grant', 'The refresh token is not valid.');
      default:
        return temporarilyUnavailable();
    }
  } catch (error) {
    console.error('Error in oauth token:', error instanceof Error ? error.message : 'unknown');
    return temporarilyUnavailable();
  }
}
