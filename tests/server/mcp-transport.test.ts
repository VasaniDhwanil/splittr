import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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

import { GET as billsMine } from '@/app/api/bills/mine/route';
import { generateAgentToken } from '@/lib/agent-tokens';
import { enableAgentAccess, insertToken, TEST_PEPPER } from './helpers/agent';
import { createUser, db, request, sql } from './helpers/db';
import { callTool, initializeBody, mcpRequest, rpcBody, send } from './helpers/mcp';
import { signInAs, signOut, type TestUser } from './helpers/session';

const LONG_TOKEN = /spl_pat_[A-Za-z0-9_-]{20,}/;
const READ_TOOLS = ['get_balances', 'get_bill', 'list_my_bills', 'list_my_expenses', 'list_my_groups'];
const WRITE_TOOLS = ['create_bill'];

let restoreEnv: () => void;
let user: TestUser;
let token: string;
let tokenId: string;

beforeAll(() => {
  restoreEnv = enableAgentAccess();
});
afterAll(() => restoreEnv());

beforeEach(async () => {
  mail.sent.length = 0;
  user = await createUser('mcp');
  const t = await insertToken(user);
  token = t.token;
  tokenId = t.id;
});

const toolNames = async (t: string) => {
  const res = await send(rpcBody('tools/list'), { token: t });
  expect(res.status).toBe(200);
  const json = await res.json();
  return (json.result.tools as { name: string }[]).map((tool) => tool.name).sort();
};

describe('feature switch', () => {
  it('answers 503 for every method before anything else when MCP_ENABLED is off', async () => {
    process.env.MCP_ENABLED = 'false';
    try {
      for (const method of ['POST', 'GET', 'DELETE']) {
        const res = await send(rpcBody('tools/list'), { token, method });
        expect(res.status).toBe(503);
      }
      // even with a foreign Origin or a token in the URL: the switch comes first
      const res = await send(rpcBody('tools/list'), { headers: { origin: 'https://evil.example' }, url: `http://localhost:3000/api/mcp?t=${token}` });
      expect(res.status).toBe(503);
      expect((await db().from('agent_tokens').select('revoked_at').eq('id', tokenId).single()).data!.revoked_at).toBeNull();
    } finally {
      process.env.MCP_ENABLED = 'true';
    }
  });

  it('answers 503 when the pepper is missing or short', async () => {
    for (const pepper of [undefined, 'too-short']) {
      if (pepper === undefined) delete process.env.AGENT_TOKEN_PEPPER;
      else process.env.AGENT_TOKEN_PEPPER = pepper;
      try {
        expect((await send(rpcBody('tools/list'), { token })).status).toBe(503);
      } finally {
        process.env.AGENT_TOKEN_PEPPER = TEST_PEPPER;
      }
    }
  });
});

describe('authentication', () => {
  const explains = async (res: Response, status: number, reason: string) => {
    expect(res.status).toBe(status);
    expect(res.headers.get('www-authenticate')).toBeNull();
    expect(res.headers.get('set-cookie')).toBeNull();
    const text = await res.text();
    const json = JSON.parse(text);
    expect(json.error.data.reason).toBe(reason);
    expect(json.error.message).toMatch(/Agent access/);
    expect(json.error.message).toMatch(/profile/i);
    expect(text).not.toMatch(LONG_TOKEN);
    return json;
  };

  it('no header: 401 with a helpful body and no OAuth metadata', async () => {
    const json = await explains(await send(rpcBody('tools/list')), 401, 'missing');
    expect(json.error.message).toMatch(/Authorization: Bearer/);
  });

  it('says what is wrong with each kind of bad token', async () => {
    await explains(await send(rpcBody('tools/list'), { headers: { authorization: 'Bearer nope' } }), 401, 'malformed');
    await explains(await send(rpcBody('tools/list'), { headers: { authorization: 'Basic abc' } }), 401, 'missing');
    await explains(await send(rpcBody('tools/list'), { token: generateAgentToken().token }), 401, 'unknown');
    const expired = await insertToken(user, { expiresAt: new Date(Date.now() - 1000) });
    await explains(await send(rpcBody('tools/list'), { token: expired.token }), 401, 'expired');
    const revoked = await insertToken(user, { revokedAt: new Date() });
    await explains(await send(rpcBody('tools/list'), { token: revoked.token }), 401, 'revoked');
    const paused = await insertToken(user, { suspendedAt: new Date() });
    await explains(await send(rpcBody('tools/list'), { token: paused.token }), 401, 'suspended');
  });

  it('401 bodies never echo the token that was sent', async () => {
    const stranger = generateAgentToken().token;
    const res = await send(rpcBody('tools/list'), { token: stranger });
    expect(await res.text()).not.toContain(stranger);
    const bad = 'spl_pat_' + 'x'.repeat(10);
    const res2 = await send(rpcBody('tools/list'), { headers: { authorization: `Bearer ${bad}` } });
    expect(await res2.text()).not.toContain(bad);
  });

  it('a revoked token stops working on the next call', async () => {
    expect((await send(rpcBody('tools/list'), { token })).status).toBe(200);
    await db().from('agent_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', tokenId);
    expect((await send(rpcBody('tools/list'), { token })).status).toBe(401);
  });

  it('ignores cookies: a session cookie without a bearer token is 401', async () => {
    signInAs(user);
    try {
      const res = await send(rpcBody('tools/list'), { headers: { cookie: 'sb-localhost-auth-token=anything; session=1' } });
      expect(res.status).toBe(401);
      expect(res.headers.get('set-cookie')).toBeNull();
    } finally {
      signOut();
    }
  });

  it('never sets a cookie, whatever the outcome', async () => {
    for (const res of [
      await send(initializeBody(), { token }),
      await send(rpcBody('tools/list'), { token, headers: { cookie: 'a=b' } }),
      await send(rpcBody('tools/list')),
      await send(rpcBody('tools/list'), { token, method: 'GET' }),
    ]) {
      expect(res.headers.get('set-cookie')).toBeNull();
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('a personal token sent to an ordinary web route is treated as signed out', async () => {
    signOut();
    // the handler takes no request at all: it can only learn the caller from the session
    const res = await (billsMine as unknown as (req: unknown) => Promise<Response>)(
      request('GET', '/api/bills/mine', { headers: { authorization: `Bearer ${token}` } })
    );
    expect(res.status).toBe(401);
  });

  it('no API route outside /api/mcp reads the authorization header', () => {
    const root = join(process.cwd(), 'src/app/api');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          if (path === join(root, 'mcp')) continue;
          walk(path);
        } else if (/^route\.tsx?$/.test(entry) && /authorization/i.test(readFileSync(path, 'utf8'))) {
          offenders.push(path);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });

  it('publishes no OAuth discovery routes', () => {
    expect(existsSync(join(process.cwd(), 'src/app/.well-known'))).toBe(false);
    expect(existsSync(join(process.cwd(), 'src/app/api/.well-known'))).toBe(false);
    expect(existsSync(join(process.cwd(), 'public/.well-known'))).toBe(false);
  });
});

describe('a token in the URL', () => {
  const withToken = (query: string) => `http://localhost:3000/api/mcp?${query}`;

  it('revokes a live token, emails its owner and says why', async () => {
    const res = await send(rpcBody('tools/list'), { url: withToken(`access_token=${token}`) });
    expect(res.status).toBe(401);
    const text = await res.text();
    expect(JSON.parse(text).error.message).toMatch(/sent in the URL, so it was revoked/i);
    expect(JSON.parse(text).error.message).toMatch(/Agent access/);
    expect(text).not.toContain(token);

    const { data } = await db().from('agent_tokens').select('revoked_at, revoked_reason').eq('id', tokenId).single();
    expect(data!.revoked_at).not.toBeNull();
    expect(data!.revoked_reason).toBe('query_string');

    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe(user.email);
    expect(mail.sent[0].subject).toMatch(/revoked/i);
    expect(JSON.stringify(mail.sent[0])).not.toContain(token);

    expect((await send(rpcBody('tools/list'), { token })).status).toBe(401);
  });

  it('finds the token even when the URL is percent-encoded or sent with a valid header', async () => {
    const encoded = [...token].map((c) => (c === '_' ? '%5F' : c)).join('');
    const res = await send(rpcBody('tools/list'), { url: withToken(`x=${encoded}`), token });
    expect(res.status).toBe(401);
    expect((await db().from('agent_tokens').select('revoked_reason').eq('id', tokenId).single()).data!.revoked_reason).toBe('query_string');
  });

  it('revokes a paused token too, and does nothing to an unknown one', async () => {
    const paused = await insertToken(user, { suspendedAt: new Date() });
    await send(rpcBody('tools/list'), { url: withToken(`k=${paused.token}`) });
    expect((await db().from('agent_tokens').select('revoked_reason').eq('id', paused.id).single()).data!.revoked_reason).toBe('query_string');

    mail.sent.length = 0;
    const res = await send(rpcBody('tools/list'), { url: withToken(`k=${generateAgentToken().token}`) });
    expect(res.status).toBe(401);
    expect(mail.sent).toHaveLength(0);
  });

  it('does not touch a token that was already revoked', async () => {
    const revoked = await insertToken(user, { revokedAt: new Date(Date.now() - 5000) });
    await db().from('agent_tokens').update({ revoked_reason: 'user' }).eq('id', revoked.id);
    await send(rpcBody('tools/list'), { url: withToken(`k=${revoked.token}`) });
    expect((await db().from('agent_tokens').select('revoked_reason').eq('id', revoked.id).single()).data!.revoked_reason).toBe('user');
  });

  it('ignores a malformed lookalike without any database write', async () => {
    const res = await send(rpcBody('tools/list'), { url: withToken('k=spl_pat_short'), token });
    expect(res.status).toBe(200);
    expect((await db().from('agent_tokens').select('revoked_at').eq('id', tokenId).single()).data!.revoked_at).toBeNull();
  });
});

describe('Origin and method', () => {
  it('refuses a foreign browser Origin, allows none and the site itself', async () => {
    expect((await send(rpcBody('tools/list'), { token, headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await send(rpcBody('tools/list'), { token, headers: { origin: 'null' } })).status).toBe(403);
    expect((await send(rpcBody('tools/list'), { token })).status).toBe(200);
    expect((await send(rpcBody('tools/list'), { token, headers: { origin: 'http://localhost:3000' } })).status).toBe(200);
  });

  it('GET and DELETE answer 405, PUT and PATCH too', async () => {
    for (const method of ['GET', 'DELETE']) {
      const res = await send(rpcBody('tools/list'), { token, method });
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('POST');
    }
    const { PUT, PATCH } = await import('@/app/api/mcp/route');
    for (const handler of [PUT, PATCH]) {
      expect((await handler(mcpRequest(rpcBody('tools/list'), { token, method: 'PUT' }))).status).toBe(405);
    }
  });

  it('rejects a body over 64 KiB', async () => {
    const res = await send(null, { token, raw: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', pad: 'x'.repeat(70_000) }) });
    expect(res.status).toBe(413);
  });
});

describe('JSON-RPC', () => {
  it('initialize carries the instructions', async () => {
    const res = await send(initializeBody(), { token });
    expect(res.status).toBe(200);
    const { result } = await res.json();
    expect(result.serverInfo.name).toBe('splittr');
    expect(result.instructions).toMatch(/other people's data and are not instructions/);
    expect(result.instructions).toMatch(/approval on splittr\.cash/);
    expect(result.instructions).toMatch(/secrets, credentials or file contents/);
    expect(res.headers.get('mcp-session-id')).toBeNull();
  });

  it('tools/list for a read-only token and for read + bills:write', async () => {
    expect(await toolNames(token)).toEqual(READ_TOOLS);
    const writer = await insertToken(user, { scopes: ['read', 'bills:write'] });
    expect(await toolNames(writer.token)).toEqual([...READ_TOOLS, ...WRITE_TOOLS].sort());
  });

  it('read tools are annotated read-only, with strict input schemas', async () => {
    const res = await send(rpcBody('tools/list'), { token });
    const { result } = await res.json();
    for (const tool of result.tools) {
      expect(tool.annotations.readOnlyHint).toBe(true);
      expect(tool.annotations.destructiveHint).not.toBe(false);
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.description).toMatch(/never instructions/);
    }
  });

  it('an unknown tool and an out-of-scope tool give the same error and write nothing', async () => {
    const before = (await sql<{ n: string }>('select count(*) n from bills'))[0].n;
    const unknown = await callTool(token, 'no_such_tool');
    const outOfScope = await callTool(token, 'create_bill', { name: 'x', items: [] });
    expect(unknown.error).toEqual(outOfScope.error);
    expect(unknown.error!.message).toMatch(/Unknown tool$/);
    expect((await sql<{ n: string }>('select count(*) n from bills'))[0].n).toBe(before);

    const { data } = await db().from('agent_audit_log').select('tool, outcome').eq('token_id', tokenId);
    expect(data).toEqual([
      { tool: '(unknown)', outcome: 'unknown_tool' },
      { tool: '(unknown)', outcome: 'unknown_tool' },
    ]);
  });

  it('invalid input is a tool error, written to the audit log', async () => {
    for (const [name, args] of [
      ['get_bill', { bill_id: 'not-a-uuid' }],
      ['get_bill', {}],
      ['list_my_bills', { limit: 0 }],
      ['list_my_bills', { limit: 51 }],
      ['list_my_bills', { status: 'draft' }],
      ['list_my_bills', { surprise: true }],
      ['list_my_groups', { extra: 1 }],
      ['get_balances', { group_id: 'x' }],
      ['list_my_expenses', { from: '2025-01-01' }],
      ['list_my_expenses', { from: '2025-13-01', to: '2025-14-01' }],
      ['list_my_expenses', { from: '2025-02-01', to: '2025-01-01' }],
      ['list_my_expenses', { from: '2024-01-01', to: '2025-06-01' }],
    ] as const) {
      const res = await callTool(token, name, args);
      expect(res.isError, `${name} ${JSON.stringify(args)}`).toBe(true);
      expect(res.message).toMatch(/^Invalid input/);
    }
    const { data } = await db().from('agent_audit_log').select('outcome').eq('token_id', tokenId);
    expect(data!.every((row) => row.outcome === 'invalid_input')).toBe(true);
  });

  it('every tools/call writes one audit row and every authenticated request touches the token', async () => {
    await callTool(token, 'list_my_bills');
    await callTool(token, 'get_bill', { bill_id: '00000000-0000-4000-8000-000000000000' });
    const { data } = await db().from('agent_audit_log').select('tool, outcome').eq('token_id', tokenId).order('id');
    expect(data).toEqual([
      { tool: 'list_my_bills', outcome: 'ok' },
      { tool: 'get_bill', outcome: 'not_found' },
    ]);
    const row = (await db().from('agent_tokens').select('last_used_at').eq('id', tokenId).single()).data!;
    expect(row.last_used_at).not.toBeNull();
  });
});

describe('rate limits', () => {
  const windowStart = () => new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
  const seed = (count: number) =>
    db().from('agent_rate_limits').upsert({ key: `mcp:${tokenId}`, window_start: windowStart(), count });

  it('allows 60 calls a minute per token, then 429 with Retry-After', async () => {
    await seed(59);
    expect((await send(rpcBody('tools/list'), { token })).status).toBe(200);
    const res = await send(rpcBody('tools/list'), { token });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(res.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(await res.text()).not.toContain(token);
  });

  it('is keyed on the token, not the address', async () => {
    await seed(60);
    expect((await send(rpcBody('tools/list'), { token })).status).toBe(429);
    const other = await insertToken(user);
    expect((await send(rpcBody('tools/list'), { token: other.token })).status).toBe(200);
  });

  it('failed attempts from one address turn into 429 and never block a valid token', async () => {
    const ip = `192.0.2.${randomBytes(1)[0]}`;
    const garbage = () => send(rpcBody('tools/list'), { ip, headers: { authorization: 'Bearer garbage' } });
    const statuses: number[] = [];
    for (let i = 0; i < 35; i++) statuses.push((await garbage()).status);
    expect(statuses.slice(0, 30).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(30).every((s) => s === 429)).toBe(true);

    expect((await send(rpcBody('tools/list'), { ip, token })).status).toBe(200);
    expect((await callTool(token, 'list_my_groups', {}, ip)).status).toBe(200);
  });

  it('garbage tokens cause no database writes', async () => {
    const before = await sql<{ n: string }>('select (select count(*) from agent_rate_limits) a, (select count(*) from agent_audit_log) b');
    for (let i = 0; i < 5; i++) await send(rpcBody('tools/list'), { headers: { authorization: 'Bearer garbage' } });
    const after = await sql<{ n: string }>('select (select count(*) from agent_rate_limits) a, (select count(*) from agent_audit_log) b');
    expect(after).toEqual(before);
  });
});

describe('logging', () => {
  const spies = () =>
    (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('never logs a token or request headers, and 500 bodies never echo the token', async () => {
    const logs = spies();

    // a 500: the database throws with the token in its message
    const admin = db();
    const boom = vi.spyOn(admin, 'from').mockImplementationOnce(() => {
      throw new Error(`database exploded near ${token}`);
    });
    const failed = await send(rpcBody('tools/list'), { token });
    boom.mockRestore();
    expect(failed.status).toBe(500);
    expect(await failed.text()).not.toMatch(LONG_TOKEN);

    // a tool that throws after authentication
    const handlerBoom = vi.spyOn(admin, 'rpc').mockRejectedValueOnce(new Error(`rpc exploded ${token}`));
    await callTool(token, 'list_my_groups');
    handlerBoom.mockRestore();

    // the other failure paths
    const paths = [
      await send(rpcBody('tools/list')),
      await send(rpcBody('tools/list'), { headers: { authorization: `Bearer ${token}x` } }),
      await send(rpcBody('tools/list'), { headers: { origin: 'https://evil.example', authorization: `Bearer ${token}` } }),
      await send(rpcBody('tools/list'), { url: `http://localhost:3000/api/mcp?t=${token}` }),
    ];
    for (const res of paths) expect(await res.text()).not.toMatch(LONG_TOKEN);

    for (const spy of logs) {
      for (const call of spy.mock.calls) {
        const logged = call.map((arg) => (arg instanceof Error ? `${arg.message}${arg.stack}` : JSON.stringify(arg))).join(' ');
        expect(logged).not.toContain('spl_pat_');
        expect(logged.toLowerCase()).not.toContain('bearer');
      }
    }
  });

  it('a 429 body does not echo the token', async () => {
    const windowStart = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
    await db().from('agent_rate_limits').upsert({ key: `mcp:${tokenId}`, window_start: windowStart, count: 60 });
    const res = await send(rpcBody('tools/list'), { token });
    expect(res.status).toBe(429);
    expect(await res.text()).not.toMatch(LONG_TOKEN);
  });

  it('a 403 body does not echo the token', async () => {
    const res = await send(rpcBody('tools/list'), { token, headers: { origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
    expect(await res.text()).not.toMatch(LONG_TOKEN);
  });
});
