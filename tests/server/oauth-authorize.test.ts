import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as authorize } from '@/app/oauth/authorize/route';
import { createUser, db } from './helpers/db';
import { signInAs, signOut } from './helpers/session';
import {
  CHALLENGE,
  CLAUDE_CODE_CLIENT_ID,
  HOSTED_CLIENT_ID,
  enableOAuth,
  randomIp,
  sha,
} from './helpers/oauth-server';

let restore: () => void;
beforeAll(() => {
  restore = enableOAuth();
});
afterAll(() => {
  restore();
  signOut();
});
beforeEach(() => signOut());

const HOSTED_REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const good = (over: Record<string, string | null> = {}): Record<string, string> => {
  const base: Record<string, string | null> = {
    response_type: 'code',
    client_id: CLAUDE_CODE_CLIENT_ID,
    redirect_uri: 'http://localhost:54321/callback',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    state: 'abc123',
    scope: 'read bills:write',
    resource: 'http://localhost:3199/api/mcp',
    ...over,
  };
  return Object.fromEntries(Object.entries(base).filter(([, v]) => v !== null)) as Record<string, string>;
};

const get = (query: Record<string, string> | string, ip = randomIp()) =>
  authorize(
    new NextRequest(`http://localhost:3199/oauth/authorize?${typeof query === 'string' ? query : new URLSearchParams(query)}`, {
      headers: { 'x-real-ip': ip },
    })
  );

const location = (res: Response) => res.headers.get('location');
const redirected = (res: Response) => {
  const url = new URL(location(res)!);
  return { base: `${url.origin}${url.pathname}`, params: Object.fromEntries(url.searchParams) };
};

describe('feature switch', () => {
  it('answers a not-found page when OAuth is off, whatever the request says', async () => {
    const off = enableOAuth();
    delete process.env.MCP_OAUTH_ENABLED;
    const res = await get(good());
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(location(res)).toBeNull();
    off();
    restore = enableOAuth();
  });
});

describe('client and redirect_uri errors never redirect', () => {
  const cases: [string, Record<string, string>][] = [
    ['unknown client', good({ client_id: 'https://evil.example/client.json' })],
    ['client id with trailing slash', good({ client_id: `${CLAUDE_CODE_CLIENT_ID}/` })],
    ['client id in another case', good({ client_id: CLAUDE_CODE_CLIENT_ID.toUpperCase() })],
    ['missing client id', good({ client_id: null })],
    ['missing redirect_uri', good({ redirect_uri: null })],
    ['hosted client with a loopback redirect', good({ client_id: HOSTED_CLIENT_ID })],
    ['loopback client with the hosted redirect', good({ redirect_uri: HOSTED_REDIRECT })],
    ['localhost.evil', good({ redirect_uri: 'http://localhost.evil.com:8080/callback' })],
    ['userinfo', good({ redirect_uri: 'http://user@localhost:8080/callback' })],
    ['port 0', good({ redirect_uri: 'http://localhost:0/callback' })],
    ['port 65536', good({ redirect_uri: 'http://localhost:65536/callback' })],
    ['a query on the redirect', good({ redirect_uri: 'http://localhost:8080/callback?x=1' })],
    ['ipv6 loopback', good({ redirect_uri: 'http://[::1]:8080/callback' })],
    // client and redirect come before every other check, so these still show the page
    ['bad redirect and bad response_type', good({ redirect_uri: 'https://evil.example/cb', response_type: 'token' })],
    ['bad client and bad challenge', good({ client_id: 'x', code_challenge: 'short' })],
  ];
  it.each(cases)('%s: a 400 page, no redirect, no request stored', async (_name, query) => {
    const { count: before } = await db().from('agent_oauth_requests').select('id', { count: 'exact', head: true });
    const res = await get(query);
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(location(res)).toBeNull();
    expect(res.headers.get('set-cookie')).toBeNull();
    const { count: after } = await db().from('agent_oauth_requests').select('id', { count: 'exact', head: true });
    expect(after).toBe(before);
  });

  it('refuses a repeated client_id or redirect_uri on the page too', async () => {
    const base = new URLSearchParams(good());
    for (const [name, extra] of [
      ['client_id', HOSTED_CLIENT_ID],
      ['client_id', CLAUDE_CODE_CLIENT_ID],
      ['redirect_uri', 'http://localhost:54321/callback'],
    ]) {
      const q = new URLSearchParams(base);
      q.append(name, extra);
      const res = await get(q.toString());
      expect(res.status, `${name}=${extra}`).toBe(400);
      expect(location(res)).toBeNull();
    }
  });

  it('does not reflect request input into the page', async () => {
    const res = await get(good({ client_id: '<script>alert(1)</script>' }));
    expect(await res.text()).not.toContain('<script>alert');
  });
});

describe('other errors redirect to the client with state and iss', () => {
  const cases: [string, Record<string, string>, string][] = [
    ['missing response_type', good({ response_type: null }), 'invalid_request'],
    ['response_type token', good({ response_type: 'token' }), 'unsupported_response_type'],
    ['missing code_challenge', good({ code_challenge: null }), 'invalid_request'],
    ['short code_challenge', good({ code_challenge: 'a'.repeat(42) }), 'invalid_request'],
    ['long code_challenge', good({ code_challenge: 'a'.repeat(129) }), 'invalid_request'],
    ['code_challenge with a bad character', good({ code_challenge: `${'a'.repeat(42)}+` }), 'invalid_request'],
    ['missing method', good({ code_challenge_method: null }), 'invalid_request'],
    ['method plain', good({ code_challenge_method: 'plain' }), 'invalid_request'],
    ['method s256 in lower case', good({ code_challenge_method: 's256' }), 'invalid_request'],
    ['another resource', good({ resource: 'https://www.splittr.cash/api/mcp' }), 'invalid_target'],
    ['resource without the path', good({ resource: 'http://localhost:3199' }), 'invalid_target'],
    ['resource with a query', good({ resource: 'http://localhost:3199/api/mcp?x=1' }), 'invalid_target'],
    ['resource with dot segments', good({ resource: 'http://localhost:3199/api/../api/mcp' }), 'invalid_target'],
    ['resource with an encoded path', good({ resource: 'http://localhost:3199/api/%6dcp' }), 'invalid_target'],
    ['resource with userinfo', good({ resource: 'http://a@localhost:3199/api/mcp' }), 'invalid_target'],
    ['resource on another port', good({ resource: 'http://localhost:3000/api/mcp' }), 'invalid_target'],
    ['resource that is not a URL', good({ resource: 'mcp' }), 'invalid_target'],
    ['state over 2048 characters', good({ state: 's'.repeat(2049) }), 'invalid_request'],
  ];
  it.each(cases)('%s', async (_name, query, error) => {
    const res = await get(query);
    expect(res.status).toBe(302);
    const { base, params } = redirected(res);
    expect(base).toBe('http://localhost:54321/callback');
    expect(params.error).toBe(error);
    expect(params.error_description).toBeTruthy();
    expect(params.iss).toBe('http://localhost:3199');
    // the state goes back unless it was the problem
    if (query.state === 'abc123') expect(params.state).toBe('abc123');
    else expect(params.state).toBeUndefined();
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('refuses any other parameter given twice', async () => {
    for (const name of ['response_type', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource']) {
      const q = new URLSearchParams(good());
      q.append(name, q.get(name)!);
      const res = await get(q.toString());
      expect(res.status, name).toBe(302);
      expect(redirected(res).params.error, name).toBe('invalid_request');
    }
  });

  it('redirects to the hosted callback for the hosted client', async () => {
    const res = await get(good({ client_id: HOSTED_CLIENT_ID, redirect_uri: HOSTED_REDIRECT, response_type: 'x' }));
    expect(redirected(res).base).toBe(HOSTED_REDIRECT);
  });
});

describe('a valid request', () => {
  it('stores the request, sets the binding cookie and sends the browser to the consent page', async () => {
    const res = await get(good());
    expect(res.status).toBe(302);
    const { base, params } = redirected(res);
    const id = base.replace('http://localhost:3199/oauth/consent/', '');
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(params).toEqual({});

    const cookie = res.headers.get('set-cookie')!;
    const [pair, ...attrs] = cookie.split(';').map((s) => s.trim());
    const [name, value] = pair.split('=');
    // http issuer (local runs): the __Host- prefix needs Secure, so the plain name, one cookie per request
    expect(name).toBe(`splittr-oauth-${id}`);
    expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(attrs.map((a) => a.toLowerCase())).toEqual(expect.arrayContaining(['httponly', 'samesite=lax', 'path=/']));
    expect(attrs.map((a) => a.toLowerCase())).not.toContain('secure');
    expect(res.headers.get('cache-control')).toBe('no-store');

    const { data: row } = await db().from('agent_oauth_requests').select('*').eq('id', id).single();
    expect(row).toMatchObject({
      client_id: CLAUDE_CODE_CLIENT_ID,
      redirect_uri: 'http://localhost:54321/callback',
      state: 'abc123',
      code_challenge: CHALLENGE,
      scopes_requested: ['read', 'bills:write'],
      resource: 'http://localhost:3199/api/mcp',
      status: 'pending',
      user_id: null,
      binding_hash: sha(value),
      code_hmac: null,
    });
    expect(JSON.stringify(row)).not.toContain(value);
    const minutes = (new Date(row!.expires_at).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(9.5);
    expect(minutes).toBeLessThanOrEqual(10);
  });

  it('uses the Secure __Host- cookie on an https issuer', async () => {
    const off = enableOAuth('https://www.splittr.cash');
    process.env.VERCEL_ENV = 'production';
    const res = await get(good({ resource: 'https://www.splittr.cash/api/mcp' }));
    const cookie = res.headers.get('set-cookie')!;
    const id = location(res)!.split('/').pop()!;
    expect(cookie.startsWith(`__Host-splittr-oauth-${id}=`)).toBe(true);
    expect(cookie.toLowerCase()).toContain('; secure');
    expect(cookie.toLowerCase()).not.toContain('domain=');
    expect(location(res)!.startsWith('https://www.splittr.cash/oauth/consent/')).toBe(true);
    off();
    restore = enableOAuth();
  });

  it('keeps the state verbatim and accepts 2048 characters of it', async () => {
    const state = `${'é&=? %#'.repeat(200)}`.slice(0, 2048);
    const res = await get(good({ state }));
    expect(res.status).toBe(302);
    const id = new URL(location(res)!).pathname.split('/').pop()!;
    expect((await db().from('agent_oauth_requests').select('state').eq('id', id).single()).data!.state).toBe(state);
  });

  it('works without a state and without a scope or resource', async () => {
    const res = await get(good({ state: null, scope: null, resource: null }));
    const id = new URL(location(res)!).pathname.split('/').pop()!;
    const { data } = await db().from('agent_oauth_requests').select('state, scopes_requested, resource').eq('id', id).single();
    expect(data).toEqual({ state: null, scopes_requested: [], resource: 'http://localhost:3199/api/mcp' });
  });

  it('parses scopes: unknown ones and offline_access are ignored, order is canonical', async () => {
    const res = await get(good({ scope: 'offline_access bills:write bogus read admin read' }));
    const id = new URL(location(res)!).pathname.split('/').pop()!;
    expect((await db().from('agent_oauth_requests').select('scopes_requested').eq('id', id).single()).data!.scopes_requested).toEqual([
      'read',
      'bills:write',
    ]);
  });

  it('accepts the resource with a trailing slash, an upper-case host and an explicit default port', async () => {
    for (const resource of ['http://localhost:3199/api/mcp/', 'HTTP://LOCALHOST:3199/api/mcp']) {
      const res = await get(good({ resource }));
      expect(res.status, resource).toBe(302);
      const id = new URL(location(res)!).pathname.split('/').pop()!;
      expect((await db().from('agent_oauth_requests').select('resource').eq('id', id).single()).data!.resource).toBe('http://localhost:3199/api/mcp');
    }
    const off = enableOAuth('https://www.splittr.cash');
    process.env.VERCEL_ENV = 'production';
    for (const resource of ['https://www.splittr.cash:443/api/mcp', 'HTTPS://WWW.SPLITTR.CASH/api/mcp/']) {
      expect((await get(good({ resource }))).status, resource).toBe(302);
      expect(redirected(await get(good({ resource }))).base.startsWith('https://www.splittr.cash/oauth/consent/'), resource).toBe(true);
    }
    off();
    restore = enableOAuth();
  });

  it('owns the request immediately when someone is signed in, and not otherwise', async () => {
    const user = await createUser('authz');
    signInAs(user);
    const res = await get(good());
    const id = new URL(location(res)!).pathname.split('/').pop()!;
    expect((await db().from('agent_oauth_requests').select('user_id').eq('id', id).single()).data!.user_id).toBe(user.id);
  });

  it('works for the hosted client with the claude.ai callback', async () => {
    const res = await get(good({ client_id: HOSTED_CLIENT_ID, redirect_uri: HOSTED_REDIRECT }));
    expect(res.status).toBe(302);
    expect(location(res)).toContain('/oauth/consent/');
  });

  it('writes an audit row with tool oauth', async () => {
    const user = await createUser('audit');
    signInAs(user);
    await get(good());
    const { data } = await db().from('agent_audit_log').select('tool, outcome, token_id').eq('user_id', user.id);
    expect(data).toEqual([{ tool: 'oauth', outcome: 'request_created', token_id: null }]);
  });

  it('makes a fresh request id and cookie each time', async () => {
    const a = await get(good());
    const b = await get(good());
    expect(location(a)).not.toBe(location(b));
    expect(a.headers.get('set-cookie')).not.toBe(b.headers.get('set-cookie'));
  });
});

describe('rate limits', () => {
  it('allows 20 requests per address in 10 minutes, then redirects with temporarily_unavailable', async () => {
    const ip = randomIp();
    for (let i = 0; i < 20; i++) expect((await get(good(), ip)).status).toBe(302);
    const limited = await get(good(), ip);
    expect(limited.status).toBe(302);
    expect(redirected(limited).params.error).toBe('temporarily_unavailable');
    expect(limited.headers.get('set-cookie')).toBeNull();
    // another address is unaffected
    expect(location(await get(good()))).toContain('/oauth/consent/');
  });

  it('allows 10 requests per account in 10 minutes', async () => {
    const user = await createUser('limit');
    signInAs(user);
    for (let i = 0; i < 10; i++) expect(location(await get(good())), `request ${i + 1}`).toContain('/oauth/consent/');
    const limited = await get(good());
    expect(redirected(limited).params.error).toBe('temporarily_unavailable');
  });
});
