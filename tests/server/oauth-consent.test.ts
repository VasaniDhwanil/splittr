import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mail = vi.hoisted(() => ({
  sent: [] as { to: string; subject: string; html: string; text: string }[],
  configured: true,
  fail: false,
  gate: null as null | Promise<void>,
  delivered: [] as string[],
}));

vi.mock('@/lib/email', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/email')>();
  return {
    ...real,
    isEmailConfigured: () => mail.configured,
    sendEmail: async (input: { to: string; subject: string; html: string; text: string }) => {
      if (mail.fail) return { ok: false, error: 'boom' };
      if (mail.gate) await mail.gate;
      mail.sent.push(input);
      mail.delivered.push(input.subject);
      return { ok: true, id: 'test' };
    },
  };
});

import { GET as authorize } from '@/app/oauth/authorize/route';
import { GET as getConsent } from '@/app/api/agent-oauth/requests/[id]/route';
import { POST as sendCode } from '@/app/api/agent-oauth/requests/[id]/code/route';
import { POST as approve } from '@/app/api/agent-oauth/requests/[id]/approve/route';
import { POST as deny } from '@/app/api/agent-oauth/requests/[id]/deny/route';
import { createUser, db, params, sql } from './helpers/db';
import { runAs, signInAs, signOut, setSessionAmr, type TestUser } from './helpers/session';
import { insertToken } from './helpers/agent';
import {
  CLAUDE_CODE_CLIENT_ID,
  HOSTED_CLIENT_ID,
  TEST_PEPPER,
  callApprove,
  callRedeem,
  connect,
  enableOAuth,
  randomIp,
  seedRequest,
  sha,
  type SeedRequest,
} from './helpers/oauth-server';
import { hmacOAuthCode } from '@/lib/oauth/stepup';

let restore: () => void;
beforeAll(() => {
  restore = enableOAuth();
});
afterAll(() => {
  restore();
  signOut();
});
beforeEach(() => {
  signOut();
  mail.sent = [];
  mail.configured = true;
  mail.fail = false;
  mail.gate = null;
  mail.delivered = [];
});

const ORIGIN = { origin: 'http://localhost:3199' };

type Handler = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
const call = (
  handler: Handler,
  req: SeedRequest,
  method: 'GET' | 'POST',
  opts: { body?: unknown; headers?: Record<string, string>; cookie?: string | null; id?: string } = {}
) =>
  handler(
    new NextRequest(`http://localhost:3199/api/agent-oauth/requests/${opts.id ?? req.id}`, {
      method,
      headers: {
        'x-real-ip': randomIp(),
        ...(opts.cookie === null ? {} : { cookie: `splittr-oauth-${opts.id ?? req.id}=${opts.cookie ?? req.binding}` }),
        ...(method === 'POST' ? { 'content-type': 'application/json', ...ORIGIN } : {}),
        ...opts.headers,
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    }),
    params({ id: opts.id ?? req.id })
  );

const lastCode = () => mail.sent[mail.sent.length - 1].text.match(/Splittr: (\d{6})/)![1];
const json = async (res: Response) => res.json();

const hostedRequest = (user: TestUser | null, extra = {}) => seedRequest(user, { clientId: HOSTED_CLIENT_ID, ...extra });

describe('GET /api/agent-oauth/requests/[id]', () => {
  it('shows the request to its owner, in the contract shape', async () => {
    const user = await createUser('get');
    signInAs(user);
    const req = await seedRequest(user, { scopes: ['read', 'bills:write'] });
    const res = await call(getConsent, req, 'GET');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await json(res);
    expect(body).toMatchObject({
      id: req.id,
      destination: 'loopback',
      destination_label: 'an app on this computer, such as Claude Code',
      redirect_host: 'localhost',
      client_name: 'Claude Code',
      requested_scopes: ['read', 'bills:write'],
      account_email: user.email,
      step_up: { fresh_sign_in_ok: false, code_required: true, code_sent: false },
      existing: [],
      replace_default: false,
    });
    expect(Date.parse(body.expires_at)).toBeGreaterThan(Date.now());
    expect(JSON.stringify(body)).not.toContain(req.binding);
    expect(JSON.stringify(body)).not.toContain('code_hmac');
  });

  it('describes the hosted client by its host and replaces by default', async () => {
    const user = await createUser('gethosted');
    signInAs(user);
    const body = await json(await call(getConsent, await hostedRequest(user), 'GET'));
    expect(body).toMatchObject({ destination: 'claude.ai', destination_label: 'claude.ai', redirect_host: 'claude.ai', client_name: 'Claude', replace_default: true });
  });

  it('lists this account\'s live connections of the same client only', async () => {
    const user = await createUser('existing');
    const mine = await connect(user, { scopes: ['read', 'bills:write'] });
    await connect(user, { clientId: HOSTED_CLIENT_ID });
    const revoked = await connect(user);
    await db().from('agent_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', revoked.grantId);
    await connect(await createUser('stranger'));
    signInAs(user);
    const body = await json(await call(getConsent, await seedRequest(user), 'GET'));
    expect(body.existing).toHaveLength(1);
    expect(body.existing[0]).toMatchObject({ id: mine.grantId, destination: 'loopback', scopes: ['read', 'bills:write'] });
    expect(Date.parse(body.existing[0].connected_at)).toBeLessThanOrEqual(Date.now());
  });

  it('reports the step-up state: a fresh email sign-in suffices for Claude Code only', async () => {
    const user = await createUser('stepup');
    signInAs(user);
    setSessionAmr([{ method: 'otp', ageSeconds: 30 }]);
    const code = await json(await call(getConsent, await seedRequest(user), 'GET'));
    expect(code.step_up).toEqual({ fresh_sign_in_ok: true, code_required: false, code_sent: false });
    const hosted = await json(await call(getConsent, await hostedRequest(user), 'GET'));
    expect(hosted.step_up).toEqual({ fresh_sign_in_ok: false, code_required: true, code_sent: false });
    setSessionAmr([{ method: 'otp', ageSeconds: 700 }]);
    expect((await json(await call(getConsent, await seedRequest(user), 'GET'))).step_up.code_required).toBe(true);
  });

  it('reports a sent code, and not an expired one', async () => {
    const user = await createUser('sent');
    signInAs(user);
    const live = await seedRequest(user, { codeHmac: 'x', codeExpiresAt: new Date(Date.now() + 60_000) });
    const stale = await seedRequest(user, { codeHmac: 'x', codeExpiresAt: new Date(Date.now() - 1000) });
    expect((await json(await call(getConsent, live, 'GET'))).step_up.code_sent).toBe(true);
    expect((await json(await call(getConsent, stale, 'GET'))).step_up.code_sent).toBe(false);
  });

  it('is 401 signed out and 404 without the binding cookie, with the wrong one, for a bad id, or when OAuth is off', async () => {
    const user = await createUser('guard');
    const req = await seedRequest(user);
    expect((await call(getConsent, req, 'GET')).status).toBe(401);
    signInAs(user);
    expect((await call(getConsent, req, 'GET', { cookie: null })).status).toBe(404);
    expect((await call(getConsent, req, 'GET', { cookie: 'A'.repeat(43) })).status).toBe(404);
    expect((await call(getConsent, req, 'GET', { cookie: 'short' })).status).toBe(404);
    expect((await call(getConsent, req, 'GET', { id: 'nope' })).status).toBe(404);
    expect((await call(getConsent, req, 'GET', { id: 'A'.repeat(22) })).status).toBe(404);
    expect((await call(getConsent, req, 'GET')).status).toBe(200);
    const off = enableOAuth();
    delete process.env.MCP_OAUTH_ENABLED;
    expect((await call(getConsent, req, 'GET')).status).toBe(404);
    off();
    restore = enableOAuth();
  });

  it('is 404 for anyone but the owner who lacks the cookie (with it, an account switch: below), and for expired or decided requests', async () => {
    const owner = await createUser('owner');
    const other = await createUser('other');
    const req = await seedRequest(owner);
    signInAs(other);
    expect((await call(getConsent, req, 'GET', { cookie: null })).status).toBe(404);
    signInAs(owner);
    expect((await call(getConsent, req, 'GET')).status).toBe(200);
    expect((await call(getConsent, await seedRequest(owner, { expiresAt: new Date(Date.now() - 1000) }), 'GET')).status).toBe(404);
    expect((await call(getConsent, await seedRequest(owner, { status: 'denied' }), 'GET')).status).toBe(404);
    expect((await call(getConsent, await seedRequest(owner, { status: 'approved' }), 'GET')).status).toBe(404);
  });

  it('is 401 for an OAuth-client session, like any signed-out visitor (R-O1)', async () => {
    const user = await createUser('r-o1');
    const { signInAsOAuthClient } = await import('./helpers/session');
    signInAsOAuthClient(user);
    expect((await call(getConsent, await seedRequest(user), 'GET')).status).toBe(401);
  });

  it('every consent API treats an OAuth-client session as signed out (R-O1)', async () => {
    const user = await createUser('r-o1-post');
    const { signInAsOAuthClient } = await import('./helpers/session');
    signInAsOAuthClient(user);
    const req = await seedRequest(user);
    for (const handler of [sendCode, approve, deny]) {
      expect((await call(handler, req, 'POST', { body: { scopes: ['read'] } })).status).toBe(401);
    }
  });

  it('is claimed by the first signed-in account that presents the cookie; without the cookie nobody else gets it', async () => {
    const first = await createUser('first');
    const second = await createUser('second');
    const req = await seedRequest(null);
    signInAs(first);
    expect((await call(getConsent, req, 'GET')).status).toBe(200);
    expect((await db().from('agent_oauth_requests').select('user_id').eq('id', req.id).single()).data!.user_id).toBe(first.id);
    signInAs(second);
    expect((await call(getConsent, req, 'GET', { cookie: null })).status).toBe(404);
    expect((await call(getConsent, req, 'GET', { cookie: 'x'.repeat(43) })).status).toBe(404);
    signInAs(first);
    expect((await call(getConsent, req, 'GET')).status).toBe(200);
  });

  it('is owned by exactly one of two accounts racing for an unowned request, through the route', async () => {
    const a = await createUser('race-a');
    const b = await createUser('race-b');
    for (let round = 0; round < 10; round++) {
      const req = await seedRequest(null);
      const statuses = await Promise.all([a, b].map((user) => runAs(user, async () => (await call(getConsent, req, 'GET')).status)));
      const owner = (await db().from('agent_oauth_requests').select('user_id').eq('id', req.id).single()).data!.user_id;
      expect([a.id, b.id]).toContain(owner);
      // the winner sees it; the loser, who lost the compare-and-set, gets the 404
      expect(statuses.filter((s) => s === 200)).toHaveLength(1);
      expect(statuses.filter((s) => s === 404)).toHaveLength(1);
      // and later reads agree
      const winner = owner === a.id ? a : b;
      const loser = owner === a.id ? b : a;
      expect(await runAs(winner, async () => (await call(getConsent, req, 'GET')).status)).toBe(200);
      expect(await runAs(loser, async () => (await call(getConsent, req, 'GET', { cookie: null })).status)).toBe(404);
    }
  });

  it('audits the creation of a request created signed out when it is claimed, with the claimer and the address', async () => {
    const user = await createUser('claim-audit');
    const req = await seedRequest(null);
    signInAs(user);
    const ip = randomIp();
    await call(getConsent, req, 'GET', { headers: { 'x-real-ip': ip } });
    await call(getConsent, req, 'GET', { headers: { 'x-real-ip': ip } });
    const { data } = await db().from('agent_audit_log').select('tool, outcome').eq('user_id', user.id).eq('ip', ip).order('id');
    expect(data!.filter((r) => r.outcome === 'request_created')).toEqual([{ tool: 'oauth', outcome: 'request_created' }]);
  });

  it('writes a consent_shown audit row', async () => {
    const user = await createUser('audit');
    signInAs(user);
    await call(getConsent, await seedRequest(user), 'GET');
    const { data } = await db().from('agent_audit_log').select('tool, outcome').eq('user_id', user.id);
    expect(data).toEqual([{ tool: 'oauth', outcome: 'consent_shown' }]);
  });
});

describe('POST .../code', () => {
  it('emails a code bound to the request, naming the destination, the account, the scopes and the warning', async () => {
    const user = await createUser('code');
    signInAs(user);
    const req = await hostedRequest(user, { scopes: ['read', 'bills:write'] });
    const res = await call(sendCode, req, 'POST');
    expect(res.status).toBe(200);
    expect(Date.parse((await json(res)).code_expires_at)).toBeGreaterThan(Date.now() + 9 * 60_000);

    expect(mail.sent).toHaveLength(1);
    const email = mail.sent[0];
    expect(email.to).toBe(user.email);
    for (const text of [email.text, email.html]) {
      expect(text).toContain('claude.ai');
      expect(text).toContain(user.email);
      expect(text).toContain('Read your bills');
      expect(text).toContain('Propose new bills');
      expect(text).toContain('If someone sent you this link, stop');
    }
    expect(email.text).not.toContain('—');

    const { data: row } = await db().from('agent_oauth_requests').select('code_hmac, attempts, code_expires_at').eq('id', req.id).single();
    expect(row!.code_hmac).toBe(hmacOAuthCode(TEST_PEPPER, user.id, req.id, lastCode()));
    expect(row!.code_hmac).not.toContain(lastCode());
    expect(row!.attempts).toBe(0);
  });

  it('a new code replaces the old one and resets the attempts', async () => {
    const user = await createUser('code2');
    signInAs(user);
    const req = await hostedRequest(user, { attempts: 4 });
    await call(sendCode, req, 'POST');
    const first = lastCode();
    await call(sendCode, req, 'POST');
    const { data } = await db().from('agent_oauth_requests').select('code_hmac, attempts').eq('id', req.id).single();
    expect(data!.attempts).toBe(0);
    expect(data!.code_hmac).toBe(hmacOAuthCode(TEST_PEPPER, user.id, req.id, lastCode()));
    expect(first === lastCode() || data!.code_hmac !== hmacOAuthCode(TEST_PEPPER, user.id, req.id, first)).toBe(true);
  });

  it('allows three codes an hour per account, across requests', async () => {
    const user = await createUser('code3');
    signInAs(user);
    for (let i = 0; i < 3; i++) expect((await call(sendCode, await hostedRequest(user), 'POST')).status).toBe(200);
    const res = await call(sendCode, await hostedRequest(user), 'POST');
    expect(res.status).toBe(429);
    expect(await json(res)).toMatchObject({ code: 'rate_limited' });
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(mail.sent).toHaveLength(3);
  });

  it('refuses while the account is locked, without sending', async () => {
    const user = await createUser('code4');
    signInAs(user);
    await db().from('agent_mint_state').insert({ user_id: user.id, failed_verifies: 10, locked_until: new Date(Date.now() + 3600_000).toISOString() });
    const res = await call(sendCode, await hostedRequest(user), 'POST');
    expect(res.status).toBe(429);
    expect(await json(res)).toMatchObject({ code: 'locked' });
    expect(mail.sent).toHaveLength(0);
  });

  it('requires a same-site Origin, the session and the cookie, like every consent POST', async () => {
    const user = await createUser('code5');
    const req = await hostedRequest(user);
    signInAs(user);
    expect((await call(sendCode, req, 'POST', { headers: { origin: 'https://evil.example' } })).status).toBe(403);
    const noOrigin = new NextRequest(`http://localhost:3199/api/agent-oauth/requests/${req.id}`, { method: 'POST', headers: { cookie: `splittr-oauth-${req.id}=${req.binding}` } });
    expect((await sendCode(noOrigin, params({ id: req.id }))).status).toBe(403);
    expect((await call(sendCode, req, 'POST', { cookie: null })).status).toBe(404);
    signOut();
    expect((await call(sendCode, req, 'POST')).status).toBe(401);
    expect(mail.sent).toHaveLength(0);
  });

  it('answers 503 and keeps no code when the email cannot be sent', async () => {
    const user = await createUser('code6');
    signInAs(user);
    mail.fail = true;
    const req = await hostedRequest(user);
    const res = await call(sendCode, req, 'POST');
    expect(res.status).toBe(503);
    expect(await json(res)).toMatchObject({ code: 'email_unavailable' });
    expect((await db().from('agent_oauth_requests').select('code_hmac').eq('id', req.id).single()).data!.code_hmac).toBeNull();

    mail.fail = false;
    mail.configured = false;
    expect((await call(sendCode, req, 'POST')).status).toBe(503);
  });

  it('is 404 for another account\'s request and for a decided or expired one', async () => {
    const owner = await createUser('code7');
    const other = await createUser('code8');
    const req = await hostedRequest(owner);
    signInAs(other);
    expect((await call(sendCode, req, 'POST', { cookie: null })).status).toBe(404);
    signInAs(owner);
    expect((await call(sendCode, await hostedRequest(owner, { status: 'denied' }), 'POST')).status).toBe(404);
    expect((await call(sendCode, await hostedRequest(owner, { expiresAt: new Date(Date.now() - 1000) }), 'POST')).status).toBe(404);
    expect(mail.sent).toHaveLength(0);
  });
});

describe('POST .../approve: the hosted client', () => {
  const approveWith = (req: SeedRequest, body: Record<string, unknown>, opts = {}) => call(approve, req, 'POST', { body, ...opts });

  it('needs the emailed code even after a fresh sign-in; with it, answers a redirect carrying code, state and iss', async () => {
    const user = await createUser('hosted');
    signInAs(user);
    setSessionAmr([{ method: 'otp', ageSeconds: 5 }]);
    const req = await hostedRequest(user, { state: 'xyz' });

    const none = await approveWith(req, { scopes: ['read'] });
    expect(none.status).toBe(400);
    expect(await json(none)).toMatchObject({ code: 'code_required' });

    await call(sendCode, req, 'POST');
    const res = await approveWith(req, { scopes: ['read', 'bills:write'], code: lastCode() });
    expect(res.status).toBe(200);
    const { redirect_url } = await json(res);
    const url = new URL(redirect_url);
    expect(`${url.origin}${url.pathname}`).toBe('https://claude.ai/api/mcp/auth_callback');
    expect(url.searchParams.get('state')).toBe('xyz');
    expect(url.searchParams.get('iss')).toBe('http://localhost:3199');
    const code = url.searchParams.get('code')!;
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}_[A-Za-z0-9_-]{8}$/);

    // the code is stored hashed, and exchanging it makes the grant live
    const { data: stored } = await db().from('agent_oauth_codes').select('scopes, client_id, grant_id').eq('hash', sha(code)).single();
    expect(stored).toMatchObject({ scopes: ['read', 'bills:write'], client_id: HOSTED_CLIENT_ID });
    const grant = (await db().from('agent_tokens').select('*').eq('id', stored!.grant_id).single()).data!;
    expect(grant).toMatchObject({ kind: 'oauth', oauth_status: 'pending', oauth_destination: 'claude.ai', name: 'Claude', user_id: user.id });
    expect((await callRedeem(code)).result.status).toBe('ok');
  });

  it('counts wrong codes: attempts_left, five per code, the shared lock', async () => {
    const user = await createUser('hostedwrong');
    signInAs(user);
    const req = await hostedRequest(user);
    await call(sendCode, req, 'POST');
    const left: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await approveWith(req, { scopes: ['read'], code: '000000' });
      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.code).toBe('wrong_code');
      left.push(body.attempts_left);
    }
    expect(left).toEqual([4, 3, 2, 1, 0]);
    const sixth = await approveWith(req, { scopes: ['read'], code: lastCode() });
    expect(sixth.status).toBe(400);
    expect(await json(sixth)).toMatchObject({ code: 'code_required' });
    expect((await db().from('agent_mint_state').select('failed_verifies').eq('user_id', user.id).single()).data!.failed_verifies).toBe(5);

    for (let i = 0; i < 5; i++) {
      const again = await hostedRequest(user);
      await call(sendCode, again, 'POST').catch(() => null);
      await sql(`update public.agent_oauth_requests set code_hmac = 'x', code_expires_at = now() + interval '5 minutes' where id = $1`, [again.id]);
      await approveWith(again, { scopes: ['read'], code: '000000' });
    }
    const locked = await approveWith(await hostedRequest(user), { scopes: ['read'], code: '123456' });
    expect(locked.status).toBe(429);
    expect(await json(locked)).toMatchObject({ code: 'locked' });
    expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('treats a malformed code as a wrong one and a code of another request as wrong', async () => {
    const user = await createUser('hostedbound');
    signInAs(user);
    const a = await hostedRequest(user);
    const b = await hostedRequest(user);
    await call(sendCode, a, 'POST');
    const codeA = lastCode();
    await call(sendCode, b, 'POST');
    const bad = await approveWith(b, { scopes: ['read'], code: 'abcdef' });
    expect(await json(bad)).toMatchObject({ code: 'wrong_code', attempts_left: 4 });
    const crossed = await approveWith(b, { scopes: ['read'], code: codeA });
    expect(await json(crossed)).toMatchObject({ code: 'wrong_code', attempts_left: 3 });
    expect((await approveWith(b, { scopes: ['read'], code: lastCode() })).status).toBe(200);
  });

  it('sends the connected email before answering, naming the destination, account and scopes, with a working revoke link', async () => {
    const user = await createUser('hostedmail');
    signInAs(user);
    const req = await hostedRequest(user);
    await call(sendCode, req, 'POST');
    const code = lastCode();

    let release!: () => void;
    mail.gate = new Promise<void>((resolve) => (release = resolve));
    let answered = false;
    const pending = approveWith(req, { scopes: ['read'], code }).then((res) => {
      answered = true;
      return res;
    });
    await new Promise((r) => setTimeout(r, 400));
    expect(answered).toBe(false);
    release();
    const res = await pending;
    expect(res.status).toBe(200);
    expect(mail.delivered.at(-1)).toBe('Claude was connected to your Splittr account');

    const email = mail.sent.at(-1)!;
    expect(email.to).toBe(user.email);
    expect(email.text).toContain('claude.ai');
    expect(email.text).toContain(user.email);
    expect(email.text).toContain('Read your bills');
    const secret = email.text.match(/revoke\?s=([A-Za-z0-9_-]{43})/)![1];
    const { data } = await db().from('agent_tokens').select('id').eq('revoke_link_hash', sha(secret));
    expect(data).toHaveLength(1);
    expect(email.text).not.toContain('—');
  });

  it('still approves when the connected email cannot be sent', async () => {
    const user = await createUser('hostedmailfail');
    signInAs(user);
    const req = await hostedRequest(user);
    await call(sendCode, req, 'POST');
    const code = lastCode();
    mail.fail = true;
    expect((await approveWith(req, { scopes: ['read'], code })).status).toBe(200);
  });

  it('marks the request approved and refuses a second approval', async () => {
    const user = await createUser('twice');
    signInAs(user);
    const req = await hostedRequest(user);
    await call(sendCode, req, 'POST');
    const code = lastCode();
    expect((await approveWith(req, { scopes: ['read'], code })).status).toBe(200);
    expect((await approveWith(req, { scopes: ['read'], code })).status).toBe(404);
    expect((await db().from('agent_oauth_requests').select('status').eq('id', req.id).single()).data!.status).toBe('approved');
    expect((await db().from('agent_tokens').select('id').eq('user_id', user.id)).data).toHaveLength(1);
  });

  it('lets only one of two parallel approvals through', async () => {
    const user = await createUser('parallel');
    signInAs(user);
    const req = await hostedRequest(user);
    await call(sendCode, req, 'POST');
    const code = lastCode();
    const results = await Promise.all([1, 2, 3].map(() => approveWith(req, { scopes: ['read'], code })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 404, 404]);
  });
});

describe('POST .../approve: the hosted client is never approved without a valid emailed code', () => {
  const grantsOf = async (user: TestUser) =>
    (await db().from('agent_tokens').select('id').eq('user_id', user.id).eq('kind', 'oauth')).data ?? [];

  for (const method of ['otp', 'magiclink'] as const) {
    it(`a fresh ${method} sign-in, with no code, a wrong code, a malformed code or a pushy body: always refused, nothing created`, async () => {
      const user = await createUser(`hostedfresh-${method}`);
      signInAs(user);
      setSessionAmr([{ method, ageSeconds: 1 }]);
      const req = await hostedRequest(user);
      const attempts: Record<string, unknown>[] = [
        { scopes: ['read'] },
        { scopes: ['read'], code: '' },
        { scopes: ['read'], code: '000000' },
        { scopes: ['read'], code: 'not-a-code' },
        { scopes: ['read'], replace: true },
        { scopes: ['read'], require_code: false, fresh_sign_in_ok: true, p_require_code: false },
      ];
      for (const body of attempts) {
        const res = await call(approve, req, 'POST', { body });
        expect(res.status, JSON.stringify(body)).toBe(400);
        expect(['code_required', 'wrong_code']).toContain((await json(res)).code);
      }
      expect(await grantsOf(user)).toEqual([]);
      expect((await db().from('agent_oauth_requests').select('status').eq('id', req.id).single()).data!.status).toBe('pending');
      expect((await db().from('agent_oauth_codes').select('hash').eq('request_id', req.id)).data).toEqual([]);
    });
  }

  it('the same fresh sign-in is enough for Claude Code, so the difference is the client', async () => {
    const user = await createUser('codefresh');
    signInAs(user);
    setSessionAmr([{ method: 'otp', ageSeconds: 1 }]);
    const req = await seedRequest(user);
    expect((await call(approve, req, 'POST', { body: { scopes: ['read'] } })).status).toBe(200);
  });
});

describe('POST .../approve: Claude Code', () => {
  const approveWith = (req: SeedRequest, body: Record<string, unknown>, opts = {}) => call(approve, req, 'POST', { body, ...opts });

  it.each([
    ['otp 30 seconds ago', [{ method: 'otp', ageSeconds: 30 }], 200],
    ['magiclink 9 minutes ago', [{ method: 'magiclink', ageSeconds: 540 }], 200],
    ['otp 11 minutes ago', [{ method: 'otp', ageSeconds: 660 }], 400],
    ['password 10 seconds ago', [{ method: 'password', ageSeconds: 10 }], 400],
    ['oauth session', [{ method: 'oauth_provider/authorization_code', ageSeconds: 10 }], 400],
    ['an old otp next to a fresh password', [{ method: 'otp', ageSeconds: 5000 }, { method: 'password', ageSeconds: 5 }], 400],
    ['an otp dated in the future', [{ method: 'otp', ageSeconds: -3600 }], 400],
  ] as const)('%s', async (_name, amr, status) => {
    const user = await createUser('code-fresh');
    signInAs(user);
    setSessionAmr([...amr]);
    const res = await approveWith(await seedRequest(user), { scopes: ['read'] });
    expect(res.status).toBe(status);
    if (status === 400) expect(await json(res)).toMatchObject({ code: 'code_required' });
    else expect(new URL((await json(res)).redirect_url).searchParams.get('code')).toBeTruthy();
  });

  it('accepts the emailed code instead of a fresh sign-in', async () => {
    const user = await createUser('code-instead');
    signInAs(user);
    const req = await seedRequest(user);
    await call(sendCode, req, 'POST');
    expect((await approveWith(req, { scopes: ['read'], code: lastCode() })).status).toBe(200);
    // loopback redirect carries the code to the client's own port
    expect((await db().from('agent_oauth_requests').select('status').eq('id', req.id).single()).data!.status).toBe('approved');
  });

  it('builds the redirect from the stored redirect_uri (any port), state and iss', async () => {
    const user = await createUser('code-redirect');
    signInAs(user);
    setSessionAmr([{ method: 'otp', ageSeconds: 5 }]);
    const req = await seedRequest(user, { redirectUri: 'http://127.0.0.1:61234/callback', state: 'a b&c=d' });
    const { redirect_url } = await json(await approveWith(req, { scopes: ['read'] }));
    const url = new URL(redirect_url);
    expect(`${url.origin}${url.pathname}`).toBe('http://127.0.0.1:61234/callback');
    expect(url.searchParams.get('state')).toBe('a b&c=d');
    expect(url.searchParams.get('iss')).toBe('http://localhost:3199');
  });

  it('leaves the state out when the request had none', async () => {
    const user = await createUser('nostate');
    signInAs(user);
    setSessionAmr([{ method: 'otp', ageSeconds: 5 }]);
    const { redirect_url } = await json(await approveWith(await seedRequest(user, { state: null }), { scopes: ['read'] }));
    expect(new URL(redirect_url).searchParams.has('state')).toBe(false);
  });
});

describe('POST .../approve: input, caps and replacement', () => {
  const fresh = async () => {
    const user = await createUser('input');
    signInAs(user);
    setSessionAmr([{ method: 'otp', ageSeconds: 5 }]);
    return user;
  };
  const approveWith = (req: SeedRequest, body: unknown, opts = {}) => call(approve, req, 'POST', { body, ...opts });

  it('refuses scopes without read, unknown scopes, a bad replace flag and a bad body', async () => {
    const user = await fresh();
    const req = await seedRequest(user);
    for (const body of [
      { scopes: [] },
      { scopes: ['bills:write'] },
      { scopes: ['read', 'admin'] },
      { scopes: 'read' },
      {},
      { scopes: ['read'], replace: 'yes' },
      { scopes: ['read'], code: 123456 },
    ]) {
      const res = await approveWith(req, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await json(res)).toMatchObject({ code: 'invalid_input' });
    }
    const notJson = await call(approve, req, 'POST', { headers: { 'content-type': 'text/plain' } });
    expect(notJson.status).toBe(400);
    expect((await db().from('agent_tokens').select('id').eq('user_id', user.id)).data).toHaveLength(0);
  });

  it('requires Origin, session and cookie', async () => {
    const user = await fresh();
    const req = await seedRequest(user);
    expect((await approveWith(req, { scopes: ['read'] }, { headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await approveWith(req, { scopes: ['read'] }, { cookie: null })).status).toBe(404);
    expect((await approveWith(req, { scopes: ['read'] }, { cookie: 'B'.repeat(43) })).status).toBe(404);
    signOut();
    expect((await approveWith(req, { scopes: ['read'] })).status).toBe(401);
    const other = await createUser('input2');
    signInAs(other);
    expect((await approveWith(req, { scopes: ['read'] }, { cookie: null })).status).toBe(404);
  });

  it('answers expired for an owned request that ran out, and 404 for a decided one', async () => {
    const user = await fresh();
    const expired = await approveWith(await seedRequest(user, { expiresAt: new Date(Date.now() - 1000) }), { scopes: ['read'] });
    expect(expired.status).toBe(400);
    expect(await json(expired)).toMatchObject({ code: 'expired' });
    expect((await approveWith(await seedRequest(user, { status: 'denied' }), { scopes: ['read'] })).status).toBe(404);
  });

  it('answers 409 grant_limit at five live connections', async () => {
    const user = await fresh();
    for (let i = 0; i < 5; i++) await connect(user);
    const res = await approveWith(await seedRequest(user), { scopes: ['read'] });
    expect(res.status).toBe(409);
    expect(await json(res)).toMatchObject({ code: 'grant_limit' });
    // personal tokens are separate
    const user2 = await fresh();
    for (let i = 0; i < 5; i++) await insertToken(user2);
    expect((await approveWith(await seedRequest(user2), { scopes: ['read'] })).status).toBe(200);
  });

  it('replaces the chosen connection only when the new one is redeemed', async () => {
    const user = await fresh();
    const old = await connect(user, { clientId: HOSTED_CLIENT_ID });
    const keep = await connect(user);
    const req = await hostedRequest(user);
    await call(sendCode, req, 'POST');
    const res = await approveWith(req, { scopes: ['read'], replace: true, code: lastCode() });
    expect(res.status).toBe(200);
    const code = new URL((await json(res)).redirect_url).searchParams.get('code')!;
    expect((await db().from('agent_tokens').select('revoked_at').eq('id', old.grantId).single()).data!.revoked_at).toBeNull();
    expect((await callRedeem(code)).result.status).toBe('ok');
    expect((await db().from('agent_tokens').select('revoked_reason').eq('id', old.grantId).single()).data!.revoked_reason).toBe('replaced');
    expect((await db().from('agent_tokens').select('revoked_at').eq('id', keep.grantId).single()).data!.revoked_at).toBeNull();
  });

  it('keeps an abandoned approval from disconnecting anything', async () => {
    const user = await fresh();
    const old = await connect(user, { clientId: HOSTED_CLIENT_ID });
    const req = await hostedRequest(user);
    await call(sendCode, req, 'POST');
    await approveWith(req, { scopes: ['read'], replace: true, code: lastCode() });
    // nobody redeems the code
    expect((await db().from('agent_tokens').select('revoked_at').eq('id', old.grantId).single()).data!.revoked_at).toBeNull();
  });

  it('writes an approved audit row against the grant', async () => {
    const user = await fresh();
    const res = await approveWith(await seedRequest(user), { scopes: ['read'] });
    const code = new URL((await json(res)).redirect_url).searchParams.get('code')!;
    const grant = (await db().from('agent_oauth_codes').select('grant_id').eq('hash', sha(code)).single()).data!.grant_id;
    const { data } = await db().from('agent_audit_log').select('tool, outcome, token_id').eq('user_id', user.id);
    expect(data).toEqual([{ tool: 'oauth', outcome: 'approved', token_id: grant }]);
  });

  it('is unaffected by the loopback client being asked for code: a grant for the wrong client cannot be made', async () => {
    const user = await fresh();
    const req = await seedRequest(user, { clientId: CLAUDE_CODE_CLIENT_ID });
    const res = await approveWith(req, { scopes: ['read'] });
    const code = new URL((await json(res)).redirect_url).searchParams.get('code')!;
    expect((await db().from('agent_oauth_codes').select('client_id').eq('hash', sha(code)).single()).data!.client_id).toBe(CLAUDE_CODE_CLIENT_ID);
    // callApprove is exercised in the function tests; this keeps the import honest
    expect(typeof callApprove).toBe('function');
  });
});

describe('POST .../deny', () => {
  it('closes the request and redirects with access_denied, state and iss', async () => {
    const user = await createUser('deny');
    signInAs(user);
    const req = await hostedRequest(user, { state: 's-1' });
    const res = await call(deny, req, 'POST');
    expect(res.status).toBe(200);
    const url = new URL((await json(res)).redirect_url);
    expect(`${url.origin}${url.pathname}`).toBe('https://claude.ai/api/mcp/auth_callback');
    expect(url.searchParams.get('error')).toBe('access_denied');
    expect(url.searchParams.get('state')).toBe('s-1');
    expect(url.searchParams.get('iss')).toBe('http://localhost:3199');
    expect(url.searchParams.has('code')).toBe(false);
    expect((await db().from('agent_oauth_requests').select('status').eq('id', req.id).single()).data!.status).toBe('denied');
    expect((await db().from('agent_tokens').select('id').eq('user_id', user.id)).data).toHaveLength(0);
    const { data } = await db().from('agent_audit_log').select('outcome').eq('user_id', user.id);
    expect(data).toEqual([{ outcome: 'denied' }]);
  });

  it('cannot be followed by an approval, and cannot be repeated', async () => {
    const user = await createUser('deny2');
    signInAs(user);
    setSessionAmr([{ method: 'otp', ageSeconds: 5 }]);
    const req = await seedRequest(user);
    expect((await call(deny, req, 'POST')).status).toBe(200);
    expect((await call(approve, req, 'POST', { body: { scopes: ['read'] } })).status).toBe(404);
    expect((await call(deny, req, 'POST')).status).toBe(404);
  });

  it('requires Origin, session, cookie and ownership', async () => {
    const owner = await createUser('deny3');
    const req = await seedRequest(owner);
    signInAs(owner);
    expect((await call(deny, req, 'POST', { headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await call(deny, req, 'POST', { cookie: null })).status).toBe(404);
    signOut();
    expect((await call(deny, req, 'POST')).status).toBe(401);
    signInAs(await createUser('deny4'));
    expect((await call(deny, req, 'POST', { cookie: null })).status).toBe(404);
    signInAs(owner);
    expect((await call(deny, await seedRequest(owner, { expiresAt: new Date(Date.now() - 1000) }), 'POST')).status).toBe(404);
  });
});

describe('the binding cookie is per request', () => {
  const start = async (clientId: string, redirect: string) => {
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirect,
      code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      code_challenge_method: 'S256',
      state: 'st',
    });
    const res = await authorize(new NextRequest(`http://localhost:3199/oauth/authorize?${query}`, { headers: { 'x-real-ip': randomIp() } }));
    expect(res.status).toBe(302);
    const id = res.headers.get('location')!.split('/').pop()!;
    const [name, value] = res.headers.get('set-cookie')!.split(';')[0].split('=');
    return { id, name, value };
  };
  const asking = (jar: Record<string, string>, id: string, method: 'GET' | 'POST' = 'GET', body?: unknown) => {
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    const req = new NextRequest(`http://localhost:3199/api/agent-oauth/requests/${id}${method === 'POST' ? '/approve' : ''}`, {
      method,
      headers: { 'x-real-ip': randomIp(), cookie, ...(method === 'POST' ? { 'content-type': 'application/json', ...ORIGIN } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return method === 'GET' ? getConsent(req, params({ id })) : approve(req, params({ id }));
  };

  it('two connections started in one browser both work, and each cookie opens only its own request', async () => {
    const user = await createUser('jar');
    signInAs(user);
    const a = await start(CLAUDE_CODE_CLIENT_ID, 'http://localhost:54321/callback');
    const b = await start(CLAUDE_CODE_CLIENT_ID, 'http://localhost:54322/callback');
    expect(a.name).toBe(`splittr-oauth-${a.id}`);
    expect(b.name).toBe(`splittr-oauth-${b.id}`);
    expect(a.name).not.toBe(b.name);

    const jar = { [a.name]: a.value, [b.name]: b.value };
    expect((await asking(jar, a.id)).status).toBe(200);
    expect((await asking(jar, b.id)).status).toBe(200);
    // B's cookie alone does not open A, and A's value under B's name does not either
    expect((await asking({ [b.name]: b.value }, a.id)).status).toBe(404);
    expect((await asking({ [b.name]: a.value }, b.id)).status).toBe(404);

    // Approve both (a fresh email sign-in suffices for Claude Code)
    setSessionAmr([{ method: 'otp', ageSeconds: 5 }]);
    const first = await asking(jar, a.id, 'POST', { scopes: ['read'], replace: false });
    expect(first.status).toBe(200);
    expect(((await first.json()) as { redirect_url: string }).redirect_url).toContain('http://localhost:54321/callback?code=');
    const second = await asking(jar, b.id, 'POST', { scopes: ['read'], replace: false });
    expect(second.status).toBe(200);
    expect(((await second.json()) as { redirect_url: string }).redirect_url).toContain('http://localhost:54322/callback?code=');
  });

  it('the old shared cookie name no longer opens anything', async () => {
    const user = await createUser('oldname');
    signInAs(user);
    const a = await start(CLAUDE_CODE_CLIENT_ID, 'http://localhost:54321/callback');
    expect((await asking({ 'splittr-oauth': a.value }, a.id)).status).toBe(404);
  });
});

describe('"Not you? Switch account"', () => {
  const approveWith = (req: SeedRequest, body: Record<string, unknown>) => call(approve, req, 'POST', { body });

  it('lets a different account with the binding cookie take over, then approve with its own emailed code', async () => {
    const a = await createUser('switch-a');
    const b = await createUser('switch-b');
    const req = await hostedRequest(a);
    signInAs(a);
    expect((await call(sendCode, req, 'POST')).status).toBe(200);
    const codeForA = lastCode();

    signInAs(b);
    const shown = await call(getConsent, req, 'GET');
    expect(shown.status).toBe(200);
    expect(await json(shown)).toMatchObject({ account_email: b.email, step_up: { code_sent: false, code_required: true } });
    const row = (await db().from('agent_oauth_requests').select('user_id, code_hmac, code_expires_at, attempts').eq('id', req.id).single()).data!;
    expect(row).toMatchObject({ user_id: b.id, code_hmac: null, code_expires_at: null, attempts: 0 });

    // A's code, sent to A's inbox, cannot approve for B
    const wrong = await approveWith(req, { scopes: ['read'], code: codeForA });
    expect(wrong.status).toBe(400);

    expect((await call(sendCode, req, 'POST')).status).toBe(200);
    expect(mail.sent[mail.sent.length - 1].to).toBe(b.email);
    const ok = await approveWith(req, { scopes: ['read'], code: lastCode() });
    expect(ok.status).toBe(200);
    const grant = (await db().from('agent_tokens').select('user_id').eq('oauth_client_id', HOSTED_CLIENT_ID).eq('user_id', b.id)).data!;
    expect(grant).toHaveLength(1);
  });

  it('a code sent while A owned the request fails for B even when B never asks for one', async () => {
    const a = await createUser('switch-c');
    const b = await createUser('switch-d');
    const req = await hostedRequest(a);
    signInAs(a);
    await call(sendCode, req, 'POST');
    const codeForA = lastCode();
    signInAs(b);
    await call(getConsent, req, 'GET');
    const res = await approveWith(req, { scopes: ['read'], code: codeForA });
    expect(await json(res)).toMatchObject({ code: 'code_required' });
    expect((await db().from('agent_tokens').select('id').eq('user_id', b.id).eq('kind', 'oauth')).data).toHaveLength(0);
  });

  it('gives B a 404 without the cookie, and leaves the owner as it was', async () => {
    const a = await createUser('switch-e');
    const b = await createUser('switch-f');
    const req = await hostedRequest(a);
    signInAs(b);
    for (const handler of [getConsent, sendCode, approve, deny]) {
      expect((await call(handler, req, 'POST' as 'GET', { cookie: null, body: { scopes: ['read'] } })).status).toBe(404);
    }
    expect((await db().from('agent_oauth_requests').select('user_id').eq('id', req.id).single()).data!.user_id).toBe(a.id);
  });

  it('does not take over a decided, expired or already granted request', async () => {
    const a = await createUser('switch-g');
    const b = await createUser('switch-h');
    signInAs(b);
    for (const extra of [{ status: 'denied' as const }, { status: 'approved' as const }, { expiresAt: new Date(Date.now() - 1000) }]) {
      const req = await seedRequest(a, extra);
      expect((await call(getConsent, req, 'GET')).status).toBe(404);
      expect((await db().from('agent_oauth_requests').select('user_id').eq('id', req.id).single()).data!.user_id).toBe(a.id);
    }
    const granted = await seedRequest(a);
    const { data: grant } = await db()
      .from('agent_tokens')
      .insert({ user_id: a.id, name: 'Claude', kind: 'oauth', scopes: ['read'], oauth_client_id: CLAUDE_CODE_CLIENT_ID, oauth_destination: 'loopback', oauth_status: 'pending', expires_at: new Date(Date.now() + 600_000).toISOString(), revoke_link_hash: sha('x' + granted.id) })
      .select('id')
      .single();
    await db().from('agent_oauth_requests').update({ grant_id: grant!.id }).eq('id', granted.id);
    expect((await call(getConsent, granted, 'GET')).status).toBe(404);
    expect((await db().from('agent_oauth_requests').select('user_id').eq('id', granted.id).single()).data!.user_id).toBe(a.id);
  });

  it('writes an audit row for the takeover, and none for a first claim', async () => {
    const a = await createUser('switch-i');
    const b = await createUser('switch-j');
    const first = await seedRequest(null);
    signInAs(a);
    await call(getConsent, first, 'GET');
    const taken = await seedRequest(a);
    signInAs(b);
    await call(getConsent, taken, 'GET');
    const rows = (await db().from('agent_audit_log').select('user_id, outcome').in('outcome', ['consent_account_switched'])).data!.filter((r) => [a.id, b.id].includes(r.user_id));
    expect(rows).toEqual([{ user_id: b.id, outcome: 'consent_account_switched' }]);
  });

  it('two accounts racing to take over an owned request end with one owner and one 200', async () => {
    const owner = await createUser('switch-k');
    const b = await createUser('switch-l');
    const c = await createUser('switch-m');
    for (let round = 0; round < 8; round++) {
      const req = await seedRequest(owner);
      const statuses = await Promise.all([b, c].map((user) => runAs(user, async () => (await call(getConsent, req, 'GET')).status)));
      expect(statuses.filter((s) => s === 200)).toHaveLength(1);
      const now = (await db().from('agent_oauth_requests').select('user_id').eq('id', req.id).single()).data!.user_id;
      expect([b.id, c.id]).toContain(now);
    }
  });
});
