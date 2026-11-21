import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as authorizationServer } from '@/app/.well-known/oauth-authorization-server/route';
import { GET as resourceRoot } from '@/app/.well-known/oauth-protected-resource/route';
import { GET as resourceMcp } from '@/app/.well-known/oauth-protected-resource/api/mcp/route';
import { enableOAuth } from './helpers/oauth-server';

let restore: () => void;
beforeAll(() => {
  restore = enableOAuth();
});
afterAll(() => restore());

const asJson = async (res: Response) => res.json();

describe('discovery documents', () => {
  it('serves the authorization server metadata exactly', async () => {
    const res = await authorizationServer();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await asJson(res)).toEqual({
      issuer: 'http://localhost:3199',
      authorization_endpoint: 'http://localhost:3199/oauth/authorize',
      token_endpoint: 'http://localhost:3199/api/oauth/token',
      revocation_endpoint: 'http://localhost:3199/api/oauth/revoke',
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      revocation_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      client_id_metadata_document_supported: true,
      scopes_supported: ['read', 'bills:write', 'offline_access'],
      authorization_response_iss_parameter_supported: true,
    });
  });

  for (const [name, handler] of [
    ['/.well-known/oauth-protected-resource', resourceRoot],
    ['/.well-known/oauth-protected-resource/api/mcp', resourceMcp],
  ] as const) {
    it(`serves the protected resource metadata at ${name}`, async () => {
      const res = await handler();
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('public, max-age=300');
      expect(await asJson(res)).toEqual({
        resource: 'http://localhost:3199/api/mcp',
        authorization_servers: ['http://localhost:3199'],
        bearer_methods_supported: ['header'],
        scopes_supported: ['read', 'bills:write'],
        resource_name: 'Splittr',
      });
    });
  }

  it('never advertises private_key_jwt, a registration endpoint, the plain method or OpenID Connect', async () => {
    const text = JSON.stringify([await asJson(await authorizationServer()), await asJson(await resourceMcp())]);
    for (const forbidden of ['private_key_jwt', 'registration_endpoint', 'plain', 'client_secret', 'userinfo', 'jwks_uri', 'openid', 'implicit', 'password']) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });

  it('is built from the configured issuer, which is the production origin by default', async () => {
    const off = enableOAuth('https://www.splittr.cash');
    process.env.VERCEL_ENV = 'production';
    const as = await asJson(await authorizationServer());
    expect(as.issuer).toBe('https://www.splittr.cash');
    expect(as.token_endpoint).toBe('https://www.splittr.cash/api/oauth/token');
    expect((await asJson(await resourceMcp())).resource).toBe('https://www.splittr.cash/api/mcp');
    off();
    restore = enableOAuth();
  });

  it('is 404 for all three when OAuth is off, whatever else is on', async () => {
    const off = enableOAuth();
    delete process.env.MCP_OAUTH_ENABLED;
    for (const handler of [authorizationServer, resourceRoot, resourceMcp]) {
      const res = await handler();
      expect(res.status).toBe(404);
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    off();
    restore = enableOAuth();
  });
});
