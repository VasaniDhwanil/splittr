/**
 * The discovery documents (docs/specs/mcp-oauth.md S9, A11), built from
 * configuration only. What is deliberately NOT here: a registration endpoint
 * (the two clients are pinned), private_key_jwt (Claude would switch to its
 * confidential-client document), the plain PKCE method, OpenID Connect.
 */
import { NextResponse } from 'next/server';
import { isOAuthEnabled, oauthIssuer, oauthResource } from '@/lib/oauth/config';

export const OAUTH_SCOPES = ['read', 'bills:write'] as const;

export function authorizationServerMetadata() {
  const issuer = oauthIssuer();
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    revocation_endpoint: `${issuer}/api/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    client_id_metadata_document_supported: true,
    scopes_supported: [...OAUTH_SCOPES, 'offline_access'],
    authorization_response_iss_parameter_supported: true,
  };
}

export function protectedResourceMetadata() {
  return {
    resource: oauthResource(),
    authorization_servers: [oauthIssuer()],
    bearer_methods_supported: ['header'],
    scopes_supported: [...OAUTH_SCOPES],
    resource_name: 'Splittr',
  };
}

/** 404 when OAuth is off; otherwise the document, cacheable for five minutes. */
export function discoveryResponse(build: () => object): NextResponse {
  if (!isOAuthEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  return NextResponse.json(build(), { headers: { 'Cache-Control': 'public, max-age=300' } });
}
