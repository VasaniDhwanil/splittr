import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mail = vi.hoisted(() => ({ sent: [] as { to: string; subject: string; html: string; text: string }[] }));

vi.mock('@/lib/email', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/email')>();
  return {
    ...real,
    isEmailConfigured: () => true,
    sendEmail: async (input: { to: string; subject: string; html: string; text: string }) => {
      mail.sent.push(input);
      return { ok: true, id: 'test' };
    },
  };
});

import { generateAgentToken } from '@/lib/agent-tokens';
import { generateOAuthTokenPair } from '@/lib/oauth/tokens';
import { connect, enableOAuth, grantRow, TEST_PEPPER } from './helpers/oauth-server';
import { billExists, insertProposal } from './helpers/agent';
import { createBill, createGroup, createUser, db } from './helpers/db';
import { callTool, mcpRequest, rpcBody, send } from './helpers/mcp';
import { signOut, type TestUser } from './helpers/session';

const METADATA = 'http://localhost:3199/.well-known/oauth-protected-resource/api/mcp';
const CHALLENGE = `Bearer resource_metadata="${METADATA}", scope="read bills:write"`;
const CHALLENGE_INVALID = `${CHALLENGE}, error="invalid_token"`;
const READ_TOOLS = ['get_balances', 'get_bill', 'list_my_bills', 'list_my_expenses', 'list_my_groups'];
const ITEMS = [{ name: 'Pasta', price: 18.5, quantity: 1 }];

let restoreEnv: () => void;
beforeAll(() => {
  restoreEnv = enableOAuth();
});
afterAll(() => restoreEnv());

let user: TestUser;
beforeEach(async () => {
  signOut();
  mail.sent.length = 0;
  user = await createUser('oauthmcp', 'Olive Oauth');
});
afterEach(() => vi.restoreAllMocks());

const names = async (token: string) =>
  ((await (await send(rpcBody('tools/list'), { token })).json()).result.tools as { name: string }[]).map((t) => t.name).sort();

describe('the whole v1 pipeline through an OAuth access token', () => {
  it('initialize and tools/list work, and bills:write decides whether create_bill is listed', async () => {
    const readOnly = await connect(user, { scopes: ['read'] });
    const writer = await connect(user, { scopes: ['read', 'bills:write'] });

    const init = await send(rpcBody('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1' } }), {
      token: readOnly.pair.access,
    });
    expect(init.status).toBe(200);
    expect(await names(readOnly.pair.access)).toEqual(READ_TOOLS);
    expect(await names(writer.pair.access)).toEqual([...READ_TOOLS, 'create_bill'].sort());
  });

  it('every read tool works for a grant with read, and none for a grant without it (scopes come from the grant)', async () => {
    const bill = await createBill({ creator: user, name: 'Own dinner' });
    const group = await createGroup(user, []);
    const { pair, grantId } = await connect(user, { scopes: ['read'] });

    const list = await callTool(pair.access, 'list_my_bills', {});
    expect((list.data.bills as { id: string }[]).map((b) => b.id)).toEqual([bill.id]);
    expect((await callTool(pair.access, 'get_bill', { bill_id: bill.id })).isError).toBe(false);
    expect((await callTool(pair.access, 'list_my_expenses', { from: '2026-01-01', to: '2026-12-31' })).isError).toBe(false);
    const groups = await callTool(pair.access, 'list_my_groups', {});
    expect((groups.data.groups as { id: string }[]).map((g) => g.id)).toEqual([group.id]);
    expect((await callTool(pair.access, 'get_balances', {})).isError).toBe(false);

    // Take read away in the database: the next call sees it at once
    await db().from('agent_tokens').update({ scopes: ['bills:write'] }).eq('id', grantId);
    for (const [tool, args] of [
      ['list_my_bills', {}],
      ['get_bill', { bill_id: bill.id }],
      ['list_my_expenses', { from: '2026-01-01', to: '2026-12-31' }],
      ['list_my_groups', {}],
      ['get_balances', {}],
    ] as const) {
      const refused = await callTool(pair.access, tool, args);
      const unknown = await callTool(pair.access, 'no_such_tool', {});
      expect(refused.error).toEqual(unknown.error);
    }
  });

  it("another account's bills stay invisible", async () => {
    const other = await createUser('other');
    const theirs = await createBill({ creator: other, name: 'Theirs' });
    const { pair } = await connect(user, { scopes: ['read'] });
    expect((await callTool(pair.access, 'get_bill', { bill_id: theirs.id })).isError).toBe(true);
    expect((await callTool(pair.access, 'list_my_bills', {})).data.bills).toEqual([]);
  });

  it('create_bill proposes a bill under the grant, and a read-only grant cannot', async () => {
    const writer = await connect(user, { scopes: ['read', 'bills:write'] });
    const res = await callTool(writer.pair.access, 'create_bill', { name: 'Team dinner', items: ITEMS });
    expect(res.isError).toBe(false);
    const bill = (await db().from('bills').select('*').eq('id', res.data.bill_id).single()).data!;
    expect(bill).toMatchObject({
      created_via: 'agent',
      agent_token_id: writer.grantId,
      approval_required: true,
      approved_at: null,
      creator_user_id: user.id,
    });

    const readOnly = await connect(user, { scopes: ['read'] });
    const refused = await callTool(readOnly.pair.access, 'create_bill', { name: 'x', items: ITEMS });
    expect(refused.error).toEqual((await callTool(readOnly.pair.access, 'no_such_tool', {})).error);
    expect((await db().from('bills').select('id').eq('creator_user_id', user.id).eq('agent_token_id', readOnly.grantId)).data).toEqual([]);
  });

  it('a call is audited and rate limited per grant, and touches last_used_at', async () => {
    const { pair, grantId } = await connect(user, { scopes: ['read'] });
    await callTool(pair.access, 'list_my_groups', {});
    const audit = (await db().from('agent_audit_log').select('tool, outcome').eq('token_id', grantId).eq('tool', 'list_my_groups')).data!;
    expect(audit).toHaveLength(1);
    expect((await grantRow(grantId)).last_used_at).not.toBeNull();

    for (let i = 0; i < 59; i += 1) {
      await db().rpc('agent_rate_limit', { p_key: `mcp:${grantId}`, p_limit: 60, p_window_seconds: 60 });
    }
    const limited = await send(rpcBody('tools/list'), { token: pair.access });
    expect(limited.status).toBe(429);
  });

  it('the circuit breaker pauses a grant after repeated refusals and the next call is a 403', async () => {
    const writer = await connect(user, { scopes: ['read', 'bills:write'] });
    const tooPricey = [{ name: 'Car', price: 5000, quantity: 1 }];
    for (let i = 0; i < 5; i += 1) await callTool(writer.pair.access, 'create_bill', { name: `n${i}`, items: tooPricey });
    expect((await grantRow(writer.grantId)).suspended_at).not.toBeNull();
    const res = await send(rpcBody('tools/list'), { token: writer.pair.access });
    expect(res.status).toBe(403);
    expect(res.headers.get('www-authenticate')).toBeNull();
    const json = await res.json();
    expect(json.error.data.reason).toBe('suspended');
    expect(json.error.message).toMatch(/paused/i);
    expect(json.error.message).toMatch(/Why:/);
  });
});

describe('the 401 challenge', () => {
  it('a missing credential carries resource_metadata and scope, without error', async () => {
    const res = await send(rpcBody('tools/list'));
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(CHALLENGE);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect((await res.json()).error.data.reason).toBe('missing');
  });

  it('a non-Bearer Authorization header is the same as none', async () => {
    const res = await send(rpcBody('tools/list'), { headers: { authorization: 'Basic abc' } });
    expect(res.headers.get('www-authenticate')).toBe(CHALLENGE);
  });

  it('a failing OAuth token adds error="invalid_token": unknown, forged, expired, revoked, refresh token, garbage', async () => {
    const { pair, grantId } = await connect(user);
    const unknown = generateOAuthTokenPair(TEST_PEPPER).access;
    const forged = pair.access.slice(0, -2) + (pair.access.endsWith('AA') ? 'BB' : 'AA');
    const cases: Record<string, string> = { unknown, forged, refresh: pair.refresh, garbage: 'not-a-token', swappedPrefix: pair.access.replace('spl_oat_', 'spl_ort_') };
    for (const [label, token] of Object.entries(cases)) {
      const res = await send(rpcBody('tools/list'), { token });
      expect(res.status, label).toBe(401);
      expect(res.headers.get('www-authenticate'), label).toBe(CHALLENGE_INVALID);
      expect(await res.text(), label).not.toContain(token);
    }

    await db().from('agent_oauth_tokens').update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq('grant_id', grantId).eq('type', 'access');
    const expired = await send(rpcBody('tools/list'), { token: pair.access });
    expect(expired.status).toBe(401);
    expect(expired.headers.get('www-authenticate')).toBe(CHALLENGE_INVALID);
    expect((await expired.json()).error.data.reason).toBe('expired');

    const fresh = await connect(user);
    await db().from('agent_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', fresh.grantId);
    const revoked = await send(rpcBody('tools/list'), { token: fresh.pair.access });
    expect(revoked.status).toBe(401);
    expect(revoked.headers.get('www-authenticate')).toBe(CHALLENGE_INVALID);
  });

  it('a pending grant gives no access', async () => {
    const { pair, grantId } = await connect(user);
    await db().from('agent_tokens').update({ oauth_status: 'pending' }).eq('id', grantId);
    const res = await send(rpcBody('tools/list'), { token: pair.access });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(CHALLENGE_INVALID);
  });

  it('a failing well-formed personal token keeps the v1 401: no challenge at all', async () => {
    const res = await send(rpcBody('tools/list'), { token: generateAgentToken().token });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBeNull();
    expect((await res.json()).error.data.reason).toBe('unknown');
    const malformed = await send(rpcBody('tools/list'), { token: 'spl_pat_short' });
    expect(malformed.status).toBe(401);
    expect(malformed.headers.get('www-authenticate')).toBeNull();
  });

  it('a suspended grant is a 403 with the reason, never a 401', async () => {
    const { pair, grantId } = await connect(user);
    await db().from('agent_tokens').update({ suspended_at: new Date().toISOString(), suspended_reason: 'Too many declines.' }).eq('id', grantId);
    const res = await send(rpcBody('tools/list'), { token: pair.access });
    expect(res.status).toBe(403);
    expect(res.headers.get('www-authenticate')).toBeNull();
    expect((await res.json()).error.message).toContain('Too many declines.');
  });

  it('a database error looking up the token is 503 with Retry-After, never 401', async () => {
    const { pair } = await connect(user);
    const real = db().from.bind(db());
    vi.spyOn(db(), 'from').mockImplementation(((table: string) => {
      if (table === 'agent_oauth_tokens') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: '57P01', message: 'x' } }) }) }) } as never;
      }
      return real(table);
    }) as never);
    const res = await send(rpcBody('tools/list'), { token: pair.access });
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('5');
    expect(res.headers.get('www-authenticate')).toBeNull();
    vi.restoreAllMocks();
    expect((await send(rpcBody('tools/list'), { token: pair.access })).status).toBe(200);
  });
});

describe('the failed-auth limiter counts only failing personal tokens', () => {
  const ip = () => `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  it('40 missing credentials and 40 failing OAuth tokens from one address are all plain 401s', async () => {
    const addr = ip();
    const { pair } = await connect(user);
    const forged = pair.access.slice(0, -2) + (pair.access.endsWith('AA') ? 'BB' : 'AA');
    for (let i = 0; i < 40; i += 1) {
      expect((await send(rpcBody('tools/list'), { ip: addr })).status).toBe(401);
      expect((await send(rpcBody('tools/list'), { ip: addr, token: forged })).status).toBe(401);
      expect((await send(rpcBody('tools/list'), { ip: addr, token: generateOAuthTokenPair(TEST_PEPPER).access })).status).toBe(401);
    }
    // ... and a valid token from the same address is untouched
    expect((await send(rpcBody('tools/list'), { ip: addr, token: pair.access })).status).toBe(200);
  });

  it('failing personal tokens still turn into 429 after 30', async () => {
    const addr = ip();
    const statuses: number[] = [];
    for (let i = 0; i < 33; i += 1) statuses.push((await send(rpcBody('tools/list'), { ip: addr, token: generateAgentToken().token })).status);
    expect(statuses.slice(0, 30).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(30)).toEqual([429, 429, 429]);
  });
});

describe('with OAuth switched off', () => {
  let restoreOff: () => void;
  beforeEach(() => {
    const before = process.env.MCP_OAUTH_ENABLED;
    delete process.env.MCP_OAUTH_ENABLED;
    restoreOff = () => {
      process.env.MCP_OAUTH_ENABLED = before;
    };
  });
  afterEach(() => restoreOff());

  it('401s carry no challenge, exactly as in v1', async () => {
    const missing = await send(rpcBody('tools/list'));
    expect(missing.status).toBe(401);
    expect(missing.headers.get('www-authenticate')).toBeNull();
    const refresh = await send(rpcBody('tools/list'), { token: generateOAuthTokenPair(TEST_PEPPER).refresh });
    expect(refresh.status).toBe(401);
    expect(refresh.headers.get('www-authenticate')).toBeNull();
  });

  it('an access token is 503 (the kill switch), grants untouched, and works again when it is back on', async () => {
    const { pair, grantId } = await connect(user);
    const res = await send(rpcBody('tools/list'), { token: pair.access });
    expect(res.status).toBe(503);
    expect(res.headers.get('www-authenticate')).toBeNull();
    expect((await grantRow(grantId)).revoked_at).toBeNull();
    process.env.MCP_OAUTH_ENABLED = 'true';
    expect((await send(rpcBody('tools/list'), { token: pair.access })).status).toBe(200);
  });

  it('personal tokens are unaffected, and claude.ai is not an allowed Origin', async () => {
    const pat = generateAgentToken();
    expect((await send(rpcBody('tools/list'), { token: pat.token })).status).toBe(401);
    expect((await send(rpcBody('tools/list'), { headers: { origin: 'https://claude.ai' } })).status).toBe(403);
  });
});

describe('Origin', () => {
  it('allows none, the request origin and https://claude.ai; other browser origins are 403', async () => {
    const { pair } = await connect(user);
    const call = (origin?: string) => send(rpcBody('tools/list'), { token: pair.access, ...(origin ? { headers: { origin } } : {}) });
    expect((await call()).status).toBe(200);
    expect((await call('http://localhost:3000')).status).toBe(200);
    expect((await call('https://claude.ai')).status).toBe(200);
    for (const origin of ['https://evil.example', 'null', 'https://claude.ai.evil.example', 'http://claude.ai', 'https://www.claude.ai']) {
      expect((await call(origin)).status, origin).toBe(403);
    }
  });
});

describe('a token in the URL', () => {
  const withToken = (query: string) => `http://localhost:3000/api/mcp?${query}`;

  it('revokes the grant of a leaked access token, emails the owner, deletes unapproved proposals', async () => {
    const { pair, grantId } = await connect(user, { scopes: ['read', 'bills:write'] });
    const pending = await insertProposal(user, grantId);
    const approved = await insertProposal(user, grantId, { approved: true });
    const res = await send(rpcBody('tools/list'), { url: withToken(`access_token=${pair.access}`) });
    expect(res.status).toBe(401);
    const text = await res.text();
    expect(JSON.parse(text).error.message).toMatch(/sent in the URL, so it was revoked/i);
    expect(text).not.toContain(pair.access);

    const grant = await grantRow(grantId);
    expect(grant.revoked_at).not.toBeNull();
    expect(grant.revoked_reason).toBe('query_string');
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe(user.email);
    expect(JSON.stringify(mail.sent[0])).not.toContain(pair.access);
    expect(await billExists(pending)).toBe(false);
    expect(await billExists(approved)).toBe(true);
    expect((await send(rpcBody('tools/list'), { token: pair.access })).status).toBe(401);
  });

  it('revokes the grant of a leaked refresh token, even percent-encoded', async () => {
    const { pair, grantId } = await connect(user);
    await send(rpcBody('tools/list'), { url: withToken(`x=${encodeURIComponent(pair.refresh)}`) });
    expect((await grantRow(grantId)).revoked_reason).toBe('query_string');
    expect(mail.sent).toHaveLength(1);
  });

  it('ignores a forged lookalike without any database write, and a random valid-shape unknown token', async () => {
    const { pair, grantId } = await connect(user);
    const forged = pair.access.slice(0, -2) + (pair.access.endsWith('AA') ? 'BB' : 'AA');
    const real = db().from.bind(db());
    const touched: string[] = [];
    vi.spyOn(db(), 'from').mockImplementation(((table: string) => {
      touched.push(table);
      return real(table);
    }) as never);
    const res = await send(rpcBody('tools/list'), { url: withToken(`t=${forged}`) });
    expect(res.status).toBe(401);
    expect(touched).toEqual([]);
    vi.restoreAllMocks();
    await send(rpcBody('tools/list'), { url: withToken(`t=${generateOAuthTokenPair(TEST_PEPPER).access}`) });
    expect((await grantRow(grantId)).revoked_at).toBeNull();
    expect(mail.sent).toHaveLength(0);
  });

  it('does not touch a grant that was already revoked, and never emails twice', async () => {
    const { pair, grantId } = await connect(user);
    await send(rpcBody('tools/list'), { url: withToken(`a=${pair.access}`) });
    const first = (await grantRow(grantId)).revoked_at;
    await send(rpcBody('tools/list'), { url: withToken(`a=${pair.access}`) });
    expect((await grantRow(grantId)).revoked_at).toBe(first);
    expect(mail.sent).toHaveLength(1);
  });
});

describe('a refresh token at /api/mcp', () => {
  it('is a 401 with the challenge and does not revoke anything', async () => {
    const { pair, grantId } = await connect(user);
    const res = await mcpRequest(rpcBody('tools/list'), { token: pair.refresh });
    const answer = await (await import('@/app/api/mcp/route')).POST(res);
    expect(answer.status).toBe(401);
    expect(answer.headers.get('www-authenticate')).toBe(CHALLENGE_INVALID);
    expect((await grantRow(grantId)).revoked_at).toBeNull();
  });
});

describe('a limiter that cannot be asked is a 503, not a 429 (F9)', () => {
  const failLimiter = (which: 'first' | 'daily') => {
    const admin = db();
    const real = admin.rpc.bind(admin);
    let seen = 0;
    vi.spyOn(admin, 'rpc').mockImplementation(((fn: string, args?: unknown) => {
      if (fn === 'agent_rate_limit') {
        seen++;
        if (which === 'first' || seen === 2) return Promise.resolve({ data: null, error: { message: 'down', code: '57P01', details: '', hint: '' } });
      }
      return real(fn, args as never);
    }) as never);
  };

  for (const which of ['first', 'daily'] as const) {
    it(`answers 503 with Retry-After: 5 when the ${which === 'first' ? 'per-token' : 'daily'} limiter fails`, async () => {
      const { pair } = await connect(user);
      failLimiter(which);
      const res = await send(rpcBody('tools/list'), { token: pair.access });
      expect(res.status).toBe(503);
      expect(res.headers.get('retry-after')).toBe('5');
      vi.restoreAllMocks();
      expect((await send(rpcBody('tools/list'), { token: pair.access })).status).toBe(200);
    });
  }
});

describe('the sentinel row at /api/mcp (F6)', () => {
  afterEach(async () => {
    await db().from('agent_oauth_sentinel').upsert({ id: 1 });
  });

  it('a well-keyed access token that is not found is a 503 with Retry-After without the sentinel, and a 401 with it', async () => {
    const unknown = generateOAuthTokenPair(TEST_PEPPER).access;
    await db().from('agent_oauth_sentinel').delete().eq('id', 1);
    const down = await send(rpcBody('tools/list'), { token: unknown });
    expect(down.status).toBe(503);
    expect(down.headers.get('retry-after')).toBe('5');
    await db().from('agent_oauth_sentinel').upsert({ id: 1 });
    const up = await send(rpcBody('tools/list'), { token: unknown });
    expect(up.status).toBe(401);
    expect(up.headers.get('www-authenticate')).toBe(CHALLENGE_INVALID);
  });

  it('a real token keeps working while the sentinel is missing', async () => {
    const { pair } = await connect(user);
    await db().from('agent_oauth_sentinel').delete().eq('id', 1);
    expect((await send(rpcBody('tools/list'), { token: pair.access })).status).toBe(200);
  });
});
