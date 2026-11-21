// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isOAuthEnabled, oauthIssuer, oauthResource } from '@/lib/oauth/config';

const PEPPER = 'test-pepper-0123456789-0123456789-abcdef';
const on = { MCP_ENABLED: 'true', AGENT_TOKEN_PEPPER: PEPPER, MCP_OAUTH_ENABLED: 'true' };

describe('oauth issuer and resource', () => {
  it('defaults to the canonical origin', () => {
    expect(oauthIssuer({})).toBe('https://www.splittr.cash');
    expect(oauthResource({})).toBe('https://www.splittr.cash/api/mcp');
  });

  it('comes from OAUTH_ISSUER, without a trailing slash', () => {
    expect(oauthIssuer({ OAUTH_ISSUER: 'http://localhost:3199/' })).toBe('http://localhost:3199');
    expect(oauthResource({ OAUTH_ISSUER: 'http://localhost:3199' })).toBe('http://localhost:3199/api/mcp');
  });
});

describe('isOAuthEnabled', () => {
  it('needs agent access, the OAuth switch and a production or loopback issuer', () => {
    expect(isOAuthEnabled({ ...on, VERCEL_ENV: 'production' })).toBe(true);
    expect(isOAuthEnabled({ ...on, OAUTH_ISSUER: 'http://localhost:3199' })).toBe(true);
    expect(isOAuthEnabled({ ...on, OAUTH_ISSUER: 'http://127.0.0.1:3199' })).toBe(true);
  });

  it('is off when any piece is missing', () => {
    expect(isOAuthEnabled({ ...on, MCP_OAUTH_ENABLED: undefined, VERCEL_ENV: 'production' })).toBe(false);
    expect(isOAuthEnabled({ ...on, MCP_OAUTH_ENABLED: 'TRUE', VERCEL_ENV: 'production' })).toBe(false);
    expect(isOAuthEnabled({ ...on, MCP_ENABLED: undefined, VERCEL_ENV: 'production' })).toBe(false);
    expect(isOAuthEnabled({ ...on, AGENT_TOKEN_PEPPER: 'short', VERCEL_ENV: 'production' })).toBe(false);
  });

  it('never turns on in a preview or on a development machine with the production issuer', () => {
    expect(isOAuthEnabled({ ...on })).toBe(false);
    expect(isOAuthEnabled({ ...on, VERCEL_ENV: 'preview' })).toBe(false);
    expect(isOAuthEnabled({ ...on, VERCEL_ENV: 'development' })).toBe(false);
  });

  it('is off for an issuer that is not a bare origin', () => {
    expect(isOAuthEnabled({ ...on, VERCEL_ENV: 'production', OAUTH_ISSUER: 'not a url' })).toBe(false);
    expect(isOAuthEnabled({ ...on, VERCEL_ENV: 'production', OAUTH_ISSUER: 'https://www.splittr.cash/x' })).toBe(false);
    expect(isOAuthEnabled({ ...on, OAUTH_ISSUER: 'http://localhost.evil.com' })).toBe(false);
    expect(isOAuthEnabled({ ...on, OAUTH_ISSUER: 'http://user@localhost:3199' })).toBe(false);
  });
});
