import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';

const mail = vi.hoisted(() => ({
  sent: [] as { to: string; subject: string; html: string; text: string }[],
  configured: true,
  fail: false,
}));

vi.mock('@/lib/email', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/email')>();
  return {
    ...real,
    isEmailConfigured: () => mail.configured,
    sendEmail: async (input: { to: string; subject: string; html: string; text: string }) => {
      if (mail.fail) return { ok: false, error: 'boom' };
      mail.sent.push(input);
      return { ok: true, id: 'test' };
    },
  };
});

import { GET as listTokens, POST as requestCode } from '@/app/api/agent-tokens/route';
import { POST as verifyCode } from '@/app/api/agent-tokens/verify/route';
import { DELETE as revokeToken } from '@/app/api/agent-tokens/[id]/route';
import { POST as resumeToken } from '@/app/api/agent-tokens/[id]/resume/route';
import { POST as revokeAll } from '@/app/api/agent-tokens/revoke-all/route';
import * as revokeLinkRoute from '@/app/api/agent-tokens/revoke-link/route';
import { GET as authCallback } from '@/app/auth/callback/route';
import { isWellFormedAgentToken, hashAgentToken } from '@/lib/agent-tokens';
import { enableAgentAccess, insertToken, seedPending } from './helpers/agent';
import { createUser, db, params, request } from './helpers/db';
import { globalSignOut, signInAs, signOut, type TestUser } from './helpers/session';

const ORIGIN = { origin: 'http://localhost:3000' };

const call = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (req: any, ctx?: any) => Promise<Response>,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = ORIGIN,
  ctx?: unknown
) => handler(request(method, path, { body, headers }) as never, ctx as never);

const requestOne = (body: unknown, headers?: Record<string, string>) =>
  call(requestCode, 'POST', '/api/agent-tokens', body, headers);
const verify = (code: unknown, headers?: Record<string, string>) =>
  call(verifyCode, 'POST', '/api/agent-tokens/verify', { code }, headers);

const goodBody = { name: 'Claude Desktop', scopes: ['read'], expires_in_days: 30 };
const lastCode = () => {
  const text = mail.sent[mail.sent.length - 1].text;
  return text.match(/token: (\d{6})/)![1];
};

let restoreEnv: () => void;
let user: TestUser;

beforeAll(() => {
  restoreEnv = enableAgentAccess();
});
afterAll(() => restoreEnv());

beforeEach(async () => {
  mail.sent.length = 0;
  mail.configured = true;
  mail.fail = false;
  globalSignOut.mockClear();
  user = await createUser('minter');
  signInAs(user);
});

describe('requesting a code', () => {
  it('needs a session and a same-site Origin', async () => {
    signOut();
    expect((await requestOne(goodBody)).status).toBe(401);
    signInAs(user);
    expect((await requestOne(goodBody, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await requestOne(goodBody, {})).status).toBe(403);
    expect(mail.sent).toHaveLength(0);
  });

  it('rejects bad input with invalid_input', async () => {
    for (const body of [
      { ...goodBody, name: '   ' },
      { ...goodBody, name: 'x'.repeat(61) },
      { ...goodBody, scopes: [] },
      { ...goodBody, scopes: ['admin'] },
      { ...goodBody, scopes: 'read' },
      { ...goodBody, expires_in_days: 365 },
      { ...goodBody, expires_in_days: '30' },
      null,
    ]) {
      const res = await requestOne(body);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('invalid_input');
    }
    expect(mail.sent).toHaveLength(0);
  });

  it('emails a six-digit code and stores only its HMAC', async () => {
    const res = await requestOne(goodBody);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(new Date(json.code_expires_at).getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);

    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe(user.email);
    const code = lastCode();
    expect(code).toMatch(/^\d{6}$/);

    const { data: row } = await db().from('agent_token_pending').select('*').eq('user_id', user.id).single();
    expect(row!.attempts).toBe(0);
    expect(row!.code_hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(code);
  });

  it('escapes the token name in the email', async () => {
    await requestOne({ ...goodBody, name: '<img src=x onerror=alert(1)>' });
    expect(mail.sent[0].html).not.toContain('<img');
    expect(mail.sent[0].html).toContain('&lt;img');
  });

  it('allows three requests an hour and refuses the fourth', async () => {
    for (let i = 0; i < 3; i++) expect((await requestOne(goodBody)).status).toBe(200);
    const res = await requestOne(goodBody);
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.code).toBe('rate_limited');
    expect(json.retry_after).toBeGreaterThan(0);
    expect(mail.sent).toHaveLength(3);
  });

  it('removes the pending row when the email fails', async () => {
    mail.fail = true;
    const res = await requestOne(goodBody);
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('email_unavailable');
    const { data } = await db().from('agent_token_pending').select('user_id').eq('user_id', user.id);
    expect(data).toHaveLength(0);
  });

  it('answers email_unavailable when email is not configured outside development', async () => {
    mail.configured = false;
    const res = await requestOne(goodBody);
    expect(res.status).toBe(503);
    const { data } = await db().from('agent_token_pending').select('user_id').eq('user_id', user.id);
    expect(data).toHaveLength(0);
  });

  it('only logs the code to the console in development without email', async () => {
    mail.configured = false;
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubEnv('NODE_ENV', 'development');
    try {
      expect((await requestOne(goodBody)).status).toBe(200);
      expect(log.mock.calls.flat().join(' ')).toMatch(/\d{6}/);
    } finally {
      vi.unstubAllEnvs();
      log.mockRestore();
    }
    // outside development, nothing is logged
    const quiet = vi.spyOn(console, 'log').mockImplementation(() => {});
    mail.configured = true;
    await requestOne(goodBody);
    expect(quiet).not.toHaveBeenCalled();
    quiet.mockRestore();
  });

  it('refuses with token_limit at five active tokens, and with locked while locked', async () => {
    for (let i = 0; i < 5; i++) await insertToken(user);
    const full = await requestOne(goodBody);
    expect(full.status).toBe(409);
    expect((await full.json()).code).toBe('token_limit');

    const other = await createUser('locked');
    signInAs(other);
    await db().from('agent_mint_state').insert({
      user_id: other.id,
      failed_verifies: 10,
      locked_until: new Date(Date.now() + 3600_000).toISOString(),
    });
    const locked = await requestOne(goodBody);
    expect(locked.status).toBe(429);
    const json = await locked.json();
    expect(json.code).toBe('locked');
    expect(json.retry_after).toBeGreaterThan(3000);
    expect(mail.sent).toHaveLength(0);
  });
});

describe('verifying a code', () => {
  it('needs a session and a same-site Origin', async () => {
    signOut();
    expect((await verify('123456')).status).toBe(401);
    signInAs(user);
    expect((await verify('123456', { origin: 'https://evil.example' })).status).toBe(403);
  });

  it('counts a wrong code and reports attempts left', async () => {
    await requestOne(goodBody);
    const res = await verify('000000' === lastCode() ? '111111' : '000000');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'wrong_code', attempts_left: 4 });
    const { data } = await db().from('agent_token_pending').select('attempts').eq('user_id', user.id).single();
    expect(data!.attempts).toBe(1);
  });

  it('treats a malformed code as a wrong one', async () => {
    await requestOne(goodBody);
    for (const code of ['abc', '12345', '', null, { a: 1 }]) {
      const res = await verify(code);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('wrong_code');
    }
  });

  it('refuses the sixth attempt, even with the right code', async () => {
    await requestOne(goodBody);
    const right = lastCode();
    const wrong = right === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i++) await verify(wrong);
    const res = await verify(right);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('too_many_attempts');
  });

  it('reports no_pending and expired', async () => {
    expect((await (await verify('123456')).json()).code).toBe('no_pending');
    await seedPending(user, { code: '123456', expiresAt: new Date(Date.now() - 1000) });
    expect((await (await verify('123456')).json()).code).toBe('expired');
  });

  it('mints once: the token is shown a single time and only its hash is stored', async () => {
    await requestOne({ name: 'Claude <b>Desktop</b>', scopes: ['bills:write', 'read'], expires_in_days: 7 });
    const code = lastCode();
    mail.sent.length = 0;

    const res = await verify(code);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const json = await res.json();
    expect(isWellFormedAgentToken(json.token)).toBe(true);
    expect(json).toMatchObject({ name: 'Claude <b>Desktop</b>', scopes: ['read', 'bills:write'], last4: json.token.slice(-4) });
    expect(new Date(json.expires_at).getTime()).toBeLessThan(Date.now() + 7.01 * 86_400_000);

    const { data: rows } = await db().from('agent_tokens').select('*').eq('user_id', user.id);
    expect(rows).toHaveLength(1);
    expect(rows![0].token_hash).toBe(hashAgentToken(json.token));
    const everything = JSON.stringify([rows, (await db().from('agent_token_pending').select('*')).data]);
    expect(everything).not.toContain(json.token);
    expect(everything).not.toContain(code);

    // the notice: escaped name, a revoke link whose secret is stored only as a hash
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].html).not.toContain('<b>Desktop');
    const secret = mail.sent[0].text.match(/\/agent-tokens\/revoke\?s=([A-Za-z0-9_-]{43})/)![1];
    expect(rows![0].revoke_link_hash).toBe(createHash('sha256').update(secret).digest('hex'));
    expect(JSON.stringify(rows)).not.toContain(secret);
    expect(mail.sent[0].text).not.toContain(json.token);

    // and the code is spent
    expect((await (await verify(code)).json()).code).toBe('no_pending');
  });

  it('cannot change the frozen scopes or expiry at verify time', async () => {
    await requestOne({ name: 'Frozen', scopes: ['read'], expires_in_days: 7 });
    const res = await call(verifyCode, 'POST', '/api/agent-tokens/verify', {
      code: lastCode(),
      scopes: ['read', 'bills:write'],
      expires_in_days: 90,
    });
    const json = await res.json();
    expect(json.scopes).toEqual(['read']);
    expect(new Date(json.expires_at).getTime()).toBeLessThan(Date.now() + 7.01 * 86_400_000);
  });

  it('refuses a code issued to a different account', async () => {
    await requestOne(goodBody);
    const code = lastCode();
    const other = await createUser('other');
    await seedPending(other, { code: '999999' });
    signInAs(other);
    const res = await verify(code);
    expect((await res.json()).code).toBe('wrong_code');
  });

  it('answers token_limit with 409', async () => {
    await requestOne(goodBody);
    const code = lastCode();
    for (let i = 0; i < 5; i++) await insertToken(user);
    const res = await verify(code);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('token_limit');
  });

  it('answers locked with 429 after ten wrong codes in a day', async () => {
    for (let round = 0; round < 2; round++) {
      await seedPending(user, { code: '123456' });
      for (let i = 0; i < 5; i++) await verify('000000');
    }
    await seedPending(user, { code: '123456' });
    const res = await verify('123456');
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe('locked');
  });

  it('still lets the service-role client bypass RLS after a mint', async () => {
    await requestOne(goodBody);
    await verify(lastCode());
    const { data } = await db().from('agent_tokens').select('id').eq('user_id', user.id);
    expect(data).toHaveLength(1);
  });
});

describe('feature off', () => {
  const cases: [string, () => void][] = [
    ['MCP_ENABLED unset', () => delete process.env.MCP_ENABLED],
    ['MCP_ENABLED false', () => (process.env.MCP_ENABLED = 'false')],
    ['pepper unset', () => delete process.env.AGENT_TOKEN_PEPPER],
    ['pepper too short', () => (process.env.AGENT_TOKEN_PEPPER = 'short')],
  ];

  it.each(cases)('%s: routes answer 404 and GET reports disabled', async (_name, turnOff) => {
    const back = enableAgentAccess();
    try {
      await seedPending(user, { code: '123456' });
      turnOff();
      expect((await requestOne(goodBody)).status).toBe(404);
      expect((await verify('123456')).status).toBe(404);
      expect((await call(revokeToken, 'DELETE', '/api/agent-tokens/x', undefined, ORIGIN, params({ id: crypto.randomUUID() }))).status).toBe(404);
      expect((await call(resumeToken, 'POST', '/api/agent-tokens/x/resume', undefined, ORIGIN, params({ id: crypto.randomUUID() }))).status).toBe(404);
      expect((await call(revokeAll, 'POST', '/api/agent-tokens/revoke-all')).status).toBe(404);
      expect((await call(revokeLinkRoute.POST, 'POST', '/api/agent-tokens/revoke-link', { secret: 'a'.repeat(43) })).status).toBe(404);
      const res = await call(listTokens as never, 'GET', '/api/agent-tokens');
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ enabled: false, tokens: [] });
      // nothing was minted
      const { data } = await db().from('agent_tokens').select('id').eq('user_id', user.id);
      expect(data).toHaveLength(0);
    } finally {
      back();
    }
  });
});

describe('listing tokens', () => {
  it('needs a session', async () => {
    signOut();
    expect((await call(listTokens as never, 'GET', '/api/agent-tokens')).status).toBe(401);
  });

  it('lists the caller own tokens with a status, newest first, and no secrets', async () => {
    const stranger = await createUser('stranger');
    await insertToken(stranger, { name: 'not mine' });
    const day = 86_400_000;
    await insertToken(user, { name: 'active' });
    await insertToken(user, { name: 'paused', suspendedAt: new Date() });
    await insertToken(user, { name: 'just expired', expiresAt: new Date(Date.now() - day) });
    await insertToken(user, { name: 'long expired', expiresAt: new Date(Date.now() - 40 * day) });
    await insertToken(user, { name: 'just revoked', revokedAt: new Date(Date.now() - day) });
    await insertToken(user, { name: 'long revoked', revokedAt: new Date(Date.now() - 40 * day) });

    const res = await call(listTokens as never, 'GET', '/api/agent-tokens');
    const json = await res.json();
    expect(json.enabled).toBe(true);
    expect(json.mcp_url).toBe('https://www.splittr.cash/api/mcp');
    const byName = Object.fromEntries(json.tokens.map((t: { name: string; status: string }) => [t.name, t.status]));
    expect(byName).toEqual({
      active: 'active',
      paused: 'suspended',
      'just expired': 'expired',
      'just revoked': 'revoked',
    });
    const created = json.tokens.map((t: { created_at: string }) => Date.parse(t.created_at));
    expect([...created].sort((a, b) => b - a)).toEqual(created);
    expect(Object.keys(json.tokens[0]).sort()).toEqual(
      ['created_at', 'expires_at', 'id', 'last4', 'last_used_at', 'last_used_ip', 'name', 'revoked_reason', 'scopes', 'status', 'suspended_reason'].sort()
    );
  });
});

describe('revoking', () => {
  const revoke = (id: string, headers?: Record<string, string>) =>
    call(revokeToken, 'DELETE', `/api/agent-tokens/${id}`, undefined, headers ?? ORIGIN, params({ id }));
  const resume = (id: string) =>
    call(resumeToken, 'POST', `/api/agent-tokens/${id}/resume`, undefined, ORIGIN, params({ id }));

  it('revokes your own token and keeps the row', async () => {
    const t = await insertToken(user);
    const res = await revoke(t.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const { data } = await db().from('agent_tokens').select('revoked_at, revoked_reason').eq('id', t.id).single();
    expect(data!.revoked_at).not.toBeNull();
    expect(data!.revoked_reason).toBe('user');
    expect((await revoke(t.id)).status).toBe(200); // idempotent for its owner
  });

  it('gives someone else id the same 404 as one that does not exist, and changes nothing', async () => {
    const stranger = await createUser('victim');
    const theirs = await insertToken(stranger, { suspendedAt: new Date() });
    const mine = await revoke(theirs.id);
    const missing = await revoke(crypto.randomUUID());
    const junk = await revoke('not-a-uuid');
    expect([mine.status, missing.status, junk.status]).toEqual([404, 404, 404]);
    expect(await mine.json()).toEqual(await missing.json());
    expect((await resume(theirs.id)).status).toBe(404);
    const { data } = await db().from('agent_tokens').select('revoked_at, suspended_at').eq('id', theirs.id).single();
    expect(data!.revoked_at).toBeNull();
    expect(data!.suspended_at).not.toBeNull();
  });

  it('needs a session and a same-site Origin', async () => {
    const t = await insertToken(user);
    expect((await revoke(t.id, { origin: 'https://evil.example' })).status).toBe(403);
    signOut();
    expect((await revoke(t.id)).status).toBe(401);
    const { data } = await db().from('agent_tokens').select('revoked_at').eq('id', t.id).single();
    expect(data!.revoked_at).toBeNull();
  });

  it('resumes a paused token, but not a revoked one', async () => {
    const paused = await insertToken(user, { suspendedAt: new Date() });
    expect((await resume(paused.id)).status).toBe(200);
    const { data } = await db().from('agent_tokens').select('suspended_at, suspended_reason').eq('id', paused.id).single();
    expect(data).toEqual({ suspended_at: null, suspended_reason: null });

    const dead = await insertToken(user, { revokedAt: new Date(), suspendedAt: new Date() });
    expect((await resume(dead.id)).status).toBe(404);
  });

  it('revoke-all revokes every live token, signs out everywhere and lifts the lock', async () => {
    const a = await insertToken(user);
    const b = await insertToken(user, { suspendedAt: new Date() });
    const expired = await insertToken(user, { expiresAt: new Date(Date.now() - 1000) });
    const other = await createUser('bystander');
    const theirs = await insertToken(other);
    await db().from('agent_mint_state').insert({ user_id: user.id, failed_verifies: 10, locked_until: new Date(Date.now() + 3600_000).toISOString() });

    const res = await call(revokeAll, 'POST', '/api/agent-tokens/revoke-all');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revoked: 2, signed_out: true });
    expect(globalSignOut).toHaveBeenCalledWith({ scope: 'global' });
    const { data } = await db().from('agent_tokens').select('id, revoked_at, revoked_reason').in('id', [a.id, b.id, expired.id, theirs.id]);
    const state = Object.fromEntries(data!.map((r) => [r.id, r.revoked_at !== null]));
    expect(state).toEqual({ [a.id]: true, [b.id]: true, [expired.id]: false, [theirs.id]: false });
    const { data: lock } = await db().from('agent_mint_state').select('user_id').eq('user_id', user.id);
    expect(lock).toHaveLength(0);
  });

  it('revoke-all keeps the lock when the global sign-out fails', async () => {
    await insertToken(user);
    await db().from('agent_mint_state').insert({ user_id: user.id, failed_verifies: 10, locked_until: new Date(Date.now() + 3600_000).toISOString() });
    globalSignOut.mockResolvedValueOnce({ error: { message: 'nope' } } as never);
    const res = await call(revokeAll, 'POST', '/api/agent-tokens/revoke-all');
    expect(await res.json()).toEqual({ revoked: 1, signed_out: false });
    const { data: lock } = await db().from('agent_mint_state').select('user_id').eq('user_id', user.id);
    expect(lock).toHaveLength(1);
  });

  it('revoke-all needs a session and a same-site Origin', async () => {
    expect((await call(revokeAll, 'POST', '/api/agent-tokens/revoke-all', undefined, { origin: 'https://evil.example' })).status).toBe(403);
    signOut();
    expect((await call(revokeAll, 'POST', '/api/agent-tokens/revoke-all')).status).toBe(401);
  });
});

describe('the revoke link in the email', () => {
  // random per run: the database is not reset between runs
  const secretFor = (n: string) => `${n}-${randomBytes(16).toString('hex')}`.replace(/[^A-Za-z0-9_-]/g, '').padEnd(43, 'A').slice(0, 43);
  const link = (secret: unknown, headers: Record<string, string> = ORIGIN) =>
    call(revokeLinkRoute.POST, 'POST', '/api/agent-tokens/revoke-link', { secret }, headers);

  it('has no GET handler', () => {
    expect('GET' in revokeLinkRoute).toBe(false);
  });

  it('revokes all of the owner live tokens without a session, and only theirs', async () => {
    const secret = secretFor('owner-secret');
    const a = await insertToken(user, { revokeLinkHash: hashAgentToken(secret) });
    const b = await insertToken(user);
    const other = await createUser('neighbour');
    const theirs = await insertToken(other, { revokeLinkHash: hashAgentToken(secretFor('their-secret')) });
    signOut();

    const res = await link(secret);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revoked: 2 });
    const { data } = await db().from('agent_tokens').select('id, revoked_at, revoked_reason').in('id', [a.id, b.id, theirs.id]);
    const revoked = Object.fromEntries(data!.map((r) => [r.id, r.revoked_at !== null]));
    expect(revoked).toEqual({ [a.id]: true, [b.id]: true, [theirs.id]: false });
    expect(data!.find((r) => r.id === a.id)!.revoked_reason).toBe('revoke_link');

    // pressing it twice is harmless
    expect(await (await link(secret)).json()).toEqual({ revoked: 0 });
  });

  it('answers 404 for an unknown or malformed secret', async () => {
    expect((await link(secretFor('nobody'))).status).toBe(404);
    for (const bad of ['short', '', null, 42, `${'A'.repeat(42)}!`, 'A'.repeat(44)]) {
      expect((await link(bad)).status).toBe(404);
    }
  });

  it('refuses a foreign Origin', async () => {
    const secret = secretFor('origin-secret');
    const t = await insertToken(user, { revokeLinkHash: hashAgentToken(secret) });
    expect((await link(secret, { origin: 'https://evil.example' })).status).toBe(403);
    const { data } = await db().from('agent_tokens').select('revoked_at').eq('id', t.id).single();
    expect(data!.revoked_at).toBeNull();
  });
});

describe('the lock after a fresh sign-in', () => {
  it('is cleared by a verified magic link and left alone by a failed one', async () => {
    await db().from('agent_mint_state').insert({ user_id: user.id, failed_verifies: 10, locked_until: new Date(Date.now() + 3600_000).toISOString() });

    signOut();
    await authCallback(request('GET', '/auth/callback?token_hash=bad&type=email'));
    expect((await db().from('agent_mint_state').select('user_id').eq('user_id', user.id)).data).toHaveLength(1);

    signInAs(user);
    const res = await authCallback(request('GET', '/auth/callback?token_hash=good&type=email&next=/profile'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/profile');
    expect((await db().from('agent_mint_state').select('user_id').eq('user_id', user.id)).data).toHaveLength(0);
  });

  it('does not break sign-in when the clear fails', async () => {
    await db().from('agent_mint_state').insert({ user_id: user.id, failed_verifies: 1 });
    const admin = await import('@/lib/supabase/admin');
    const real = admin.createAdminClient();
    const original = real.from.bind(real);
    const spy = vi.spyOn(real, 'from').mockImplementation(((table: string) => {
      if (table === 'agent_mint_state') throw new Error('relation "agent_mint_state" does not exist');
      return original(table);
    }) as never);
    try {
      const res = await authCallback(request('GET', '/auth/callback?token_hash=good&type=email'));
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).not.toContain('/signin');
    } finally {
      spy.mockRestore();
    }
  });
});
