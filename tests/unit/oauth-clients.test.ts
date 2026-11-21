// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  CLAUDE_CODE_CLIENT_ID,
  HOSTED_CLIENT_ID,
  allClients,
  findClient,
  matchRedirectUri,
} from '@/lib/oauth/clients';

const hosted = findClient(HOSTED_CLIENT_ID)!;
const code = findClient(CLAUDE_CODE_CLIENT_ID)!;

describe('pinned clients', () => {
  it('knows exactly two clients', () => {
    expect(allClients().map((c) => c.clientId)).toEqual([
      'https://claude.ai/oauth/mcp-oauth-client-metadata',
      'https://claude.ai/oauth/claude-code-client-metadata',
    ]);
    expect(hosted).toMatchObject({ label: 'Claude', destination: 'claude.ai' });
    expect(code).toMatchObject({ label: 'Claude Code', destination: 'loopback' });
  });

  it.each([
    undefined,
    null,
    42,
    '',
    'https://claude.ai/oauth/mcp-oauth-client-metadata/',
    'https://claude.ai/oauth/mcp-oauth-client-metadata?x=1',
    'https://claude.ai/oauth/mcp-oauth-client-metadata#',
    'HTTPS://claude.ai/oauth/mcp-oauth-client-metadata',
    'https://CLAUDE.AI/oauth/mcp-oauth-client-metadata',
    'https://claude.ai:443/oauth/mcp-oauth-client-metadata',
    'http://claude.ai/oauth/mcp-oauth-client-metadata',
    ' https://claude.ai/oauth/claude-code-client-metadata',
    'https://claude.ai/oauth/claude-code-client-metadata ',
    'https://evil.example/oauth/claude-code-client-metadata',
    'https://claude.ai/oauth/confidential_client',
    ['https://claude.ai/oauth/mcp-oauth-client-metadata'],
  ])('refuses %j as a client_id', (value) => {
    expect(findClient(value)).toBeNull();
  });
});

describe('hosted redirect URI', () => {
  it('matches the claude.ai callback exactly', () => {
    expect(matchRedirectUri(hosted, 'https://claude.ai/api/mcp/auth_callback')).toBe(true);
  });

  it.each([
    'https://claude.ai/api/mcp/auth_callback/',
    'https://claude.ai/api/mcp/auth_callback?x=1',
    'https://claude.ai/api/mcp/auth_callback#f',
    'https://claude.ai:443/api/mcp/auth_callback',
    'https://CLAUDE.AI/api/mcp/auth_callback',
    'https://Claude.ai/api/mcp/auth_callback',
    'http://claude.ai/api/mcp/auth_callback',
    'https://claude.ai/api/mcp/Auth_Callback',
    'https://claude.ai/api/mcp/auth_callback%20',
    'https://claude.ai/api/mcp/../mcp/auth_callback',
    'https://claude.ai@evil.example/api/mcp/auth_callback',
    'https://evil.example/api/mcp/auth_callback',
    'https://claude.ai.evil.example/api/mcp/auth_callback',
    'http://localhost:3000/callback',
    'http://localhost/callback',
    '',
  ])('refuses %j', (uri) => {
    expect(matchRedirectUri(hosted, uri)).toBe(false);
  });
});

describe('loopback redirect URI', () => {
  it.each([
    'http://localhost/callback',
    'http://127.0.0.1/callback',
    'http://localhost:1/callback',
    'http://localhost:54321/callback',
    'http://localhost:65535/callback',
    'http://127.0.0.1:8080/callback',
    'http://127.0.0.1:65535/callback',
  ])('matches %s', (uri) => {
    expect(matchRedirectUri(code, uri)).toBe(true);
  });

  it.each([
    ['port 0', 'http://localhost:0/callback'],
    ['port 65536', 'http://localhost:65536/callback'],
    ['port 99999', 'http://localhost:99999/callback'],
    ['port with leading zero', 'http://localhost:08080/callback'],
    ['port too long', 'http://localhost:1234567/callback'],
    ['signed port', 'http://localhost:+8080/callback'],
    ['negative port', 'http://localhost:-1/callback'],
    ['empty port', 'http://localhost:/callback'],
    ['hex port', 'http://localhost:0x50/callback'],
    ['space in port', 'http://localhost: 80/callback'],
    ['unicode digits', 'http://localhost:８０８０/callback'],
    ['trailing slash', 'http://localhost:8080/callback/'],
    ['trailing slash, no port', 'http://localhost/callback/'],
    ['other path', 'http://localhost:8080/other'],
    ['no path', 'http://localhost:8080'],
    ['query', 'http://localhost:8080/callback?code=x'],
    ['query, no port', 'http://localhost/callback?x=1'],
    ['fragment', 'http://localhost:8080/callback#x'],
    ['uppercase host', 'http://LOCALHOST:8080/callback'],
    ['uppercase path', 'http://localhost:8080/Callback'],
    ['uppercase scheme', 'HTTP://localhost:8080/callback'],
    ['https', 'https://localhost:8080/callback'],
    ['userinfo', 'http://user@localhost:8080/callback'],
    ['userinfo with password', 'http://user:pw@localhost:8080/callback'],
    ['userinfo that looks like a port', 'http://localhost:80@evil.example/callback'],
    ['evil host suffix', 'http://localhost.evil.example:8080/callback'],
    ['evil host suffix, no port', 'http://localhost.evil.example/callback'],
    ['evil host prefix', 'http://evillocalhost:8080/callback'],
    ['127.0.0.1 look-alike', 'http://127.0.0.10:8080/callback'],
    ['127.0.0.1 with suffix domain', 'http://127.0.0.1.evil.example:8080/callback'],
    ['other loopback address', 'http://127.0.0.2:8080/callback'],
    ['ipv6 loopback', 'http://[::1]:8080/callback'],
    ['ipv6 loopback, no port', 'http://[::1]/callback'],
    ['encoded host', 'http://%6Cocalhost:8080/callback'],
    ['encoded path', 'http://localhost:8080/%63allback'],
    ['encoded slash', 'http://localhost:8080%2Fcallback'],
    ['dot segments', 'http://localhost:8080/../callback'],
    ['dot segments inside', 'http://localhost:8080/x/../callback'],
    ['double slash', 'http://localhost:8080//callback'],
    ['second port', 'http://localhost:80:80/callback'],
    ['backslash', 'http://localhost:8080\\callback'],
    ['tab in port', 'http://localhost:80\t80/callback'],
    ['newline', 'http://localhost:8080/callback\n'],
    ['empty', ''],
  ])('refuses %s: %s', (_name, uri) => {
    expect(matchRedirectUri(code, uri)).toBe(false);
  });

  it('does not mix the hosts: a registered localhost URI never matches 127.0.0.1 by itself', () => {
    // Both are registered for Claude Code, so each matches its own host only
    expect(matchRedirectUri(code, 'http://localhost:1/callback')).toBe(true);
    expect(matchRedirectUri(hosted, 'http://127.0.0.1:1/callback')).toBe(false);
  });

  it('refuses non-strings and absurd lengths', () => {
    expect(matchRedirectUri(code, undefined)).toBe(false);
    expect(matchRedirectUri(code, null)).toBe(false);
    expect(matchRedirectUri(code, 5)).toBe(false);
    expect(matchRedirectUri(code, `http://localhost:8080/callback${'a'.repeat(600)}`)).toBe(false);
  });
});
