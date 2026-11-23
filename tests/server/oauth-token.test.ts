import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mail = vi.hoisted(() => ({ sent: [] as { to: string; subject: string; text: string }[] }));
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

import { POST as token } from '@/app/api/oauth/token/route';
import { generateAgentToken } from '@/lib/agent-tokens';
import { resetFailures } from '@/lib/oauth/throttle';
import { deriveFirstPair, generateOAuthTokenPair, parseOAuthToken } from '@/lib/oauth/tokens';
import { rpcBody, send } from './helpers/mcp';
import { billExists, insertProposal } from './helpers/agent';
import { createUser, db, sql } from './helpers/db';
import {
  CLAUDE_CODE_CLIENT_ID,
  HOSTED_CLIENT_ID,
  RESOURCE,
  TEST_PEPPER,
  VERIFIER,
  callApprove,
  connect,
  enableOAuth,
  formRequest,
  grantRow,
  oauthTokens,
  randomIp,
  seedRequest,
  sha,
} from './helpers/oauth-server';
import type { TestUser } from './helpers/session';

let restore: () => void;
beforeAll(() => {
  restore = enableOAuth();
});
afterAll(() => restore());
beforeEach(() => {
  mail.sent = [];
  resetFailures();
});
afterEach(() => vi.restoreAllMocks());

const post = (fields: Record<string, string> | string, headers: Record<string, string> = {}) =>
  token(formRequest('/api/oauth/token', fields, headers));
const json = (res: Response) => res.json();

/** A pending grant with a code to redeem. */
async function approved(user: TestUser, clientId = CLAUDE_CODE_CLIENT_ID, scopes = ['read', 'bills:write']) {
  const req = await seedRequest(user, { clientId });
  const { result, code } = await callApprove(user, req, { scopes, destination: clientId === HOSTED_CLIENT_ID ? 'claude.ai' : 'loopback' });
  return { code, grantId: result.grant_id!, redirectUri: clientId === HOSTED_CLIENT_ID ? 'https://claude.ai/api/mcp/auth_callback' : 'http://localhost:54321/callback' };
}

const exchange = (code: string, over: Record<string, string | null> = {}) =>
  post(
    Object.fromEntries(
      Object.entries({
        grant_type: 'authorization_code',
        client_id: CLAUDE_CODE_CLIENT_ID,
        code,
        code_verifier: VERIFIER,
        redirect_uri: 'http://localhost:54321/callback',
        resource: RESOURCE,
        ...over,
      }).filter(([, v]) => v !== null) as [string, string][]
    )
  );

const refresh = (refreshToken: string, over: Record<string, string | null> = {}) =>
  post(
    Object.fromEntries(
      Object.entries({ grant_type: 'refresh_token', client_id: CLAUDE_CODE_CLIENT_ID, refresh_token: refreshToken, ...over }).filter(
        ([, v]) => v !== null
      ) as [string, string][]
    )
  );

describe('authorization_code', () => {
  it('exchanges a code for tokens, in the RFC 6749 shape, with no caching', async () => {
    const user = await createUser('tok');
    const { code, grantId } = await approved(user);
    const res = await exchange(code);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('pragma')).toBe('no-cache');
    const body = await json(res);
    expect(Object.keys(body).sort()).toEqual(['access_token', 'expires_in', 'refresh_token', 'scope', 'token_type']);
    expect(body).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'read bills:write' });
    expect(parseOAuthToken(body.access_token, TEST_PEPPER)).toBe('access');
    expect(parseOAuthToken(body.refresh_token, TEST_PEPPER)).toBe('refresh');

    const tokens = await oauthTokens(grantId);
    expect(tokens.map((t) => t.hash).sort()).toEqual([sha(body.access_token), sha(body.refresh_token)].sort());
    expect((await grantRow(grantId)).oauth_status).toBe('live');
    const { data } = await db().from('agent_audit_log').select('tool, outcome, token_id').eq('token_id', grantId);
    expect(data).toEqual([{ tool: 'oauth', outcome: 'exchange', token_id: grantId }]);
  });

  it('answers with the granted scopes, which may be narrower than requested', async () => {
    const user = await createUser('scope');
    const { code } = await approved(user, CLAUDE_CODE_CLIENT_ID, ['read']);
    expect((await json(await exchange(code))).scope).toBe('read');
  });

  it('ignores an Authorization header and a client_secret, and any charset on the content type', async () => {
    const user = await createUser('lenient');
    const { code } = await approved(user);
    const res = await post(
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CLAUDE_CODE_CLIENT_ID,
        code,
        code_verifier: VERIFIER,
        client_secret: 'whatever',
      }).toString(),
      { authorization: 'Basic Zm9vOmJhcg==', 'content-type': 'Application/X-WWW-Form-Urlencoded; charset=ISO-8859-1' }
    );
    expect(res.status).toBe(200);
  });

  it('does not need redirect_uri or resource, but requires them to match when sent', async () => {
    const user = await createUser('optional');
    const { code } = await approved(user);
    expect((await exchange(code, { redirect_uri: null, resource: null })).status).toBe(200);

    const second = await approved(user);
    for (const resource of [`${RESOURCE}/`, 'HTTP://LOCALHOST:3199/api/mcp']) {
      const next = await approved(user);
      expect((await exchange(next.code, { resource })).status, resource).toBe(200);
    }
    // a different redirect_uri is refused, and the code stays good
    for (const redirect_uri of ['http://localhost:54322/callback', 'http://localhost:54321/callback/', 'http://localhost:54321/CALLBACK', '']) {
      const res = await exchange(second.code, { redirect_uri });
      expect(res.status, redirect_uri).toBe(400);
      expect((await json(res)).error).toBe('invalid_grant');
    }
    expect((await exchange(second.code)).status).toBe(200);
  });

  it('refuses another resource with invalid_target', async () => {
    const user = await createUser('target');
    const { code } = await approved(user);
    for (const resource of ['https://www.splittr.cash/api/mcp', 'http://localhost:3199', 'http://localhost:3199/api/other', 'junk']) {
      const res = await exchange(code, { resource });
      expect(res.status, resource).toBe(400);
      expect((await json(res)).error, resource).toBe('invalid_target');
    }
    expect((await exchange(code)).status).toBe(200);
  });

  it('refuses a wrong verifier without using up the code', async () => {
    const user = await createUser('verifier');
    const { code } = await approved(user);
    const wrong = await exchange(code, { code_verifier: 'x'.repeat(43) });
    expect(wrong.status).toBe(400);
    expect((await json(wrong)).error).toBe('invalid_grant');
    const short = await exchange(code, { code_verifier: 'short' });
    expect((await json(short)).error).toBe('invalid_grant');
    const badChars = await exchange(code, { code_verifier: `${'a'.repeat(42)}+` });
    expect((await json(badChars)).error).toBe('invalid_grant');
    expect((await exchange(code)).status).toBe(200);
  });

  it('refuses a code issued to the other client, and keeps the grant', async () => {
    const user = await createUser('otherclient');
    const { code, grantId } = await approved(user);
    const res = await exchange(code, { client_id: HOSTED_CLIENT_ID });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('invalid_grant');
    expect((await grantRow(grantId)).oauth_status).toBe('pending');
    expect((await exchange(code)).status).toBe(200);
  });

  it('refuses an unknown or malformed code, and an expired one', async () => {
    const user = await createUser('badcode');
    for (const code of ['A'.repeat(43), 'short', 'A'.repeat(44), 'spl_oat_xyz']) {
      const res = await exchange(code);
      expect(res.status, code).toBe(400);
      expect((await json(res)).error, code).toBe('invalid_grant');
    }
    const { code } = await approved(user);
    await sql(`update public.agent_oauth_codes set expires_at = now() - interval '1 second' where hash = $1`, [sha(code)]);
    expect((await json(await exchange(code))).error).toBe('invalid_grant');
  });

  it('a replay with the right bindings revokes the grant, its tokens and proposals, and tells the owner', async () => {
    const user = await createUser('replay');
    const { code, grantId } = await approved(user);
    const first = await json(await exchange(code));
    const proposal = await insertProposal(user, grantId);
    await sql(`update public.agent_oauth_codes set used_at = now() - interval '121 seconds' where hash = $1`, [sha(code)]);

    const replay = await exchange(code);
    expect(replay.status).toBe(400);
    expect((await json(replay)).error).toBe('invalid_grant');
    expect(await grantRow(grantId)).toMatchObject({ revoked_reason: 'code_replay' });
    expect(await oauthTokens(grantId)).toHaveLength(0);
    expect(await billExists(proposal)).toBe(false);
    expect((await json(await refresh(first.refresh_token))).error).toBe('invalid_grant');

    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe(user.email);
    expect(mail.sent[0].text).toContain('second time');
    const { data } = await db().from('agent_audit_log').select('outcome').eq('token_id', grantId).order('id');
    expect(data!.map((r) => r.outcome)).toEqual(['exchange', 'code_replay_revoked']);
  });

  it('a replay that fails a binding is only invalid_grant: the grant lives', async () => {
    const user = await createUser('replaywrong');
    const { code, grantId } = await approved(user);
    await exchange(code);
    for (const over of [{ code_verifier: 'x'.repeat(43) }, { client_id: HOSTED_CLIENT_ID }, { redirect_uri: 'http://localhost:1/callback' }] as Record<string, string>[]) {
      const res = await exchange(code, over);
      expect((await json(res)).error).toBe('invalid_grant');
    }
    expect((await grantRow(grantId)).revoked_at).toBeNull();
    expect(mail.sent).toHaveLength(0);
  });

  it('a retried exchange within 120 s returns the same pair and the new connection stays live', async () => {
    const user = await createUser('retry');
    const { code, grantId } = await approved(user);
    const first = await json(await exchange(code));
    const second = await exchange(code);
    expect(second.status).toBe(200);
    expect(await json(second)).toEqual(first);
    expect(await grantRow(grantId)).toMatchObject({ revoked_at: null, oauth_status: 'live' });
    expect(mail.sent).toHaveLength(0);
    // and the pair works at /api/mcp
    expect((await send(rpcBody('tools/list'), { token: first.access_token })).status).toBe(200);
    const { data } = await db().from('agent_audit_log').select('outcome').eq('token_id', grantId).eq('tool', 'oauth').order('id');
    expect(data!.map((r) => r.outcome)).toEqual(['exchange', 'exchange_replay']);
  });

  it('the first pair is derived from the code: the same code always means the same tokens', async () => {
    const user = await createUser('derived');
    const { code } = await approved(user);
    const first = await json(await exchange(code));
    const pair = deriveFirstPair(code, TEST_PEPPER);
    expect(first.access_token).toBe(pair.access);
    expect(first.refresh_token).toBe(pair.refresh);
  });

  it('a retry after the window, or after the first pair was used, revokes the grant (A12)', async () => {
    const user = await createUser('lateretry');
    const late = await approved(user);
    await exchange(late.code);
    await sql(`update public.agent_oauth_codes set used_at = now() - interval '121 seconds' where hash = $1`, [sha(late.code)]);
    expect((await json(await exchange(late.code))).error).toBe('invalid_grant');
    expect((await grantRow(late.grantId)).revoked_reason).toBe('code_replay');

    const used = await approved(user);
    const first = await json(await exchange(used.code));
    expect((await send(rpcBody('tools/list'), { token: first.access_token })).status).toBe(200);
    expect((await json(await exchange(used.code))).error).toBe('invalid_grant');
    expect((await grantRow(used.grantId)).revoked_reason).toBe('code_replay');

    const rotated = await approved(user);
    const pair = await json(await exchange(rotated.code));
    expect((await refresh(pair.refresh_token)).status).toBe(200);
    expect((await json(await exchange(rotated.code))).error).toBe('invalid_grant');
    expect((await grantRow(rotated.grantId)).revoked_reason).toBe('code_replay');
  });

  it('parallel exchanges of one code all get the same pair, and the grant stays live', async () => {
    const user = await createUser('parallel');
    const { code, grantId } = await approved(user);
    const results = await Promise.all(Array.from({ length: 6 }, () => exchange(code)));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200]);
    const bodies = await Promise.all(results.map(json));
    expect(new Set(bodies.map((b) => b.access_token)).size).toBe(1);
    expect(new Set(bodies.map((b) => b.refresh_token)).size).toBe(1);
    expect(await grantRow(grantId)).toMatchObject({ revoked_at: null, oauth_status: 'live' });
    expect(await oauthTokens(grantId)).toHaveLength(2);
    expect(mail.sent).toHaveLength(0);
  });
});

describe('request validation', () => {
  it('requires a form body, and refuses a repeated parameter anywhere', async () => {
    const json400 = async (res: Response, error = 'invalid_request') => {
      expect(res.status).toBe(400);
      expect((await json(res)).error).toBe(error);
      expect(res.headers.get('cache-control')).toBe('no-store');
    };
    const user = await createUser('form');
    const { code } = await approved(user);
    await json400(
      await token(
        new (await import('next/server')).NextRequest('http://localhost:3199/api/oauth/token', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-real-ip': randomIp() },
          body: JSON.stringify({ grant_type: 'authorization_code', client_id: CLAUDE_CODE_CLIENT_ID, code, code_verifier: VERIFIER }),
        })
      )
    );
    await json400(
      await token(
        new (await import('next/server')).NextRequest('http://localhost:3199/api/oauth/token', {
          method: 'POST',
          headers: { 'x-real-ip': randomIp() },
          body: 'grant_type=refresh_token',
        })
      )
    );
    const base = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLAUDE_CODE_CLIENT_ID,
      code,
      code_verifier: VERIFIER,
      redirect_uri: 'http://localhost:54321/callback',
      resource: RESOURCE,
    });
    for (const name of base.keys()) {
      const dup = new URLSearchParams(base);
      dup.append(name, base.get(name)!);
      await json400(await post(dup.toString()));
    }
    // the code was never touched by any of that
    expect((await exchange(code)).status).toBe(200);
  });

  it('requires client_id (invalid_request), pins it (invalid_client, 401) and requires grant_type', async () => {
    const missing = await post({ grant_type: 'refresh_token', refresh_token: 'x' });
    expect(missing.status).toBe(400);
    expect((await json(missing)).error).toBe('invalid_request');
    for (const client_id of ['https://evil.example/c.json', `${CLAUDE_CODE_CLIENT_ID}/`, 'claude-code', ' ']) {
      const res = await post({ grant_type: 'refresh_token', client_id, refresh_token: 'x' });
      expect(res.status, client_id).toBe(401);
      expect((await json(res)).error, client_id).toBe('invalid_client');
    }
    expect((await json(await post({ client_id: CLAUDE_CODE_CLIENT_ID }))).error).toBe('invalid_request');
  });

  it('refuses other grant types', async () => {
    for (const grant_type of ['password', 'client_credentials', 'urn:ietf:params:oauth:grant-type:jwt-bearer', 'implicit', 'AUTHORIZATION_CODE']) {
      const res = await post({ grant_type, client_id: HOSTED_CLIENT_ID });
      expect(res.status, grant_type).toBe(400);
      expect((await json(res)).error, grant_type).toBe('unsupported_grant_type');
    }
  });

  it('requires code and code_verifier / refresh_token', async () => {
    const base = { grant_type: 'authorization_code', client_id: CLAUDE_CODE_CLIENT_ID };
    expect((await json(await post({ ...base, code_verifier: VERIFIER }))).error).toBe('invalid_request');
    expect((await json(await post({ ...base, code: 'A'.repeat(43) }))).error).toBe('invalid_request');
    expect((await json(await post({ grant_type: 'refresh_token', client_id: CLAUDE_CODE_CLIENT_ID }))).error).toBe('invalid_request');
  });

  it('is 503 with Retry-After when OAuth is switched off', async () => {
    const off = enableOAuth();
    delete process.env.MCP_OAUTH_ENABLED;
    const res = await refresh('x');
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('5');
    off();
    restore = enableOAuth();
  });
});

describe('refresh_token', () => {
  it('rotates: new pair, old refresh token stays good inside the grace window with the same answer', async () => {
    const user = await createUser('rot');
    const { pair, grantId } = await connect(user, { scopes: ['read', 'bills:write'] });
    const first = await refresh(pair.refresh);
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('no-store');
    const body = await json(first);
    expect(body).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'read bills:write' });
    expect(body.refresh_token).not.toBe(pair.refresh);
    expect(body.access_token).not.toBe(pair.access);
    expect(parseOAuthToken(body.refresh_token, TEST_PEPPER)).toBe('refresh');

    const again = await json(await refresh(pair.refresh));
    expect(again).toEqual(body);
    // and the successor chains on
    const second = await json(await refresh(body.refresh_token));
    expect(second.refresh_token).not.toBe(body.refresh_token);
    expect((await grantRow(grantId)).revoked_at).toBeNull();
    const { data } = await db().from('agent_audit_log').select('outcome').eq('token_id', grantId).order('id');
    expect(data!.map((r) => r.outcome)).toEqual(['refresh', 'refresh_replay', 'refresh']);
  });

  it('gives parallel refreshes with one token the same pair', async () => {
    const user = await createUser('prace');
    const { pair } = await connect(user);
    const results = await Promise.all(Array.from({ length: 6 }, () => refresh(pair.refresh)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    const bodies = await Promise.all(results.map(json));
    expect(new Set(bodies.map((b) => b.refresh_token)).size).toBe(1);
    expect(new Set(bodies.map((b) => b.access_token)).size).toBe(1);
  });

  it('revokes the grant, deletes its proposals and emails the owner when a rotated token is reused later', async () => {
    const user = await createUser('reuse');
    const { pair, grantId } = await connect(user);
    const proposal = await insertProposal(user, grantId);
    const first = await json(await refresh(pair.refresh));
    await sql(`update public.agent_oauth_tokens set rotated_at = now() - interval '121 seconds' where hash = $1`, [sha(pair.refresh)]);

    const late = await refresh(pair.refresh);
    expect(late.status).toBe(400);
    expect((await json(late)).error).toBe('invalid_grant');
    expect(await grantRow(grantId)).toMatchObject({ revoked_reason: 'refresh_reuse' });
    expect(await billExists(proposal)).toBe(false);
    expect((await json(await refresh(first.refresh_token))).error).toBe('invalid_grant');

    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe(user.email);
    expect(mail.sent[0].text).toContain('refresh token');
    const { data } = await db().from('agent_audit_log').select('outcome').eq('token_id', grantId).order('id');
    expect(data!.map((r) => r.outcome)).toEqual(['refresh', 'refresh_reuse_revoked']);
  });

  it('revokes the grant when the old token comes back after its successor was used', async () => {
    const user = await createUser('reuse2');
    const { pair, grantId } = await connect(user);
    const first = await json(await refresh(pair.refresh));
    expect((await refresh(first.refresh_token)).status).toBe(200);
    expect((await refresh(pair.refresh)).status).toBe(400);
    expect((await grantRow(grantId)).revoked_at).not.toBeNull();
  });

  it('treats an access token, a personal token, a forged token and junk as not a refresh token, without asking the database', async () => {
    const user = await createUser('types');
    const { pair } = await connect(user);
    const from = vi.spyOn(db(), 'from');
    const rpc = vi.spyOn(db(), 'rpc');
    const forged = pair.refresh.slice(0, -1) + (pair.refresh.endsWith('A') ? 'B' : 'A');
    for (const value of [pair.access, generateAgentToken().token, forged, 'spl_ort_', 'garbage', pair.refresh.replace('spl_ort_', 'spl_oat_')]) {
      const res = await refresh(value);
      expect(res.status, value).toBe(400);
      expect((await json(res)).error, value).toBe('invalid_grant');
    }
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    expect((await refresh(pair.refresh)).status).toBe(200);
  });

  it('refuses a refresh token of a revoked, expired or other-client grant, and one that does not exist', async () => {
    const user = await createUser('dead');
    const revoked = await connect(user);
    await db().from('agent_tokens').update({ revoked_at: new Date().toISOString(), revoked_reason: 'user' }).eq('id', revoked.grantId);
    expect((await json(await refresh(revoked.pair.refresh))).error).toBe('invalid_grant');

    const expired = await connect(user);
    await sql(`update public.agent_tokens set expires_at = now() - interval '1 second' where id = $1`, [expired.grantId]);
    expect((await json(await refresh(expired.pair.refresh))).error).toBe('invalid_grant');

    const other = await connect(user);
    const res = await refresh(other.pair.refresh, { client_id: HOSTED_CLIENT_ID });
    expect((await json(res)).error).toBe('invalid_grant');
    expect((await grantRow(other.grantId)).revoked_at).toBeNull();
    expect((await refresh(other.pair.refresh)).status).toBe(200);

    const unknown = generateOAuthTokenPair(TEST_PEPPER).refresh;
    expect((await json(await refresh(unknown))).error).toBe('invalid_grant');
  });

  it('still refreshes a suspended grant', async () => {
    const user = await createUser('susp');
    const { pair, grantId } = await connect(user);
    await db().from('agent_tokens').update({ suspended_at: new Date().toISOString(), suspended_reason: 'test' }).eq('id', grantId);
    expect((await refresh(pair.refresh)).status).toBe(200);
  });

  it('ignores scope, accepts the exact resource and refuses another with invalid_target', async () => {
    const user = await createUser('rscope');
    const { pair } = await connect(user, { scopes: ['read'] });
    const res = await refresh(pair.refresh, { scope: 'read bills:write admin', resource: RESOURCE });
    expect(res.status).toBe(200);
    expect((await json(res)).scope).toBe('read');
    const bad = await refresh(pair.refresh, { resource: 'https://www.splittr.cash/api/mcp' });
    expect((await json(bad)).error).toBe('invalid_target');
  });
});

describe('a database error is never invalid_grant (A3)', () => {
  const dbError = { message: 'connection refused', code: '57P01', details: '', hint: '' };
  const expect503 = async (res: Response) => {
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('5');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect((await json(res)).error).toBe('temporarily_unavailable');
  };
  /** A query builder whose every step returns itself and whose end fails. */
  const failingBuilder = (): unknown => {
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    for (const name of ['select', 'eq', 'is', 'gt', 'lt', 'in', 'or', 'order', 'limit', 'update', 'insert']) builder[name] = chain;
    builder.maybeSingle = async () => ({ data: null, error: dbError });
    builder.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: dbError });
    return builder;
  };

  it('on the code lookup', async () => {
    const user = await createUser('dberr1');
    const { code } = await approved(user);
    vi.spyOn(db(), 'from').mockImplementation(failingBuilder as never);
    await expect503(await exchange(code));
    vi.restoreAllMocks();
    expect((await exchange(code)).status).toBe(200);
  });

  it('in the redeem function, leaving the code good', async () => {
    const user = await createUser('dberr2');
    const { code } = await approved(user);
    const real = db().rpc.bind(db());
    vi.spyOn(db(), 'rpc').mockImplementation(((name: string, args: never) =>
      name === 'oauth_redeem_code' ? Promise.resolve({ data: null, error: dbError }) : real(name, args)) as never);
    await expect503(await exchange(code));
    vi.restoreAllMocks();
    expect((await exchange(code)).status).toBe(200);
  });

  it('in the refresh function, leaving the token good', async () => {
    const user = await createUser('dberr3');
    const { pair, grantId } = await connect(user);
    const real = db().rpc.bind(db());
    vi.spyOn(db(), 'rpc').mockImplementation(((name: string, args: never) =>
      name === 'oauth_refresh' ? Promise.resolve({ data: null, error: dbError }) : real(name, args)) as never);
    await expect503(await refresh(pair.refresh));
    vi.restoreAllMocks();
    expect((await grantRow(grantId)).revoked_at).toBeNull();
    expect((await refresh(pair.refresh)).status).toBe(200);
  });

  it('on the refresh token lookup, and when the rate limiter cannot be asked', async () => {
    const user = await createUser('dberr4');
    const { pair } = await connect(user);
    const spy = vi.spyOn(db(), 'from').mockImplementation(failingBuilder as never);
    await expect503(await refresh(pair.refresh));
    spy.mockRestore();

    const real = db().rpc.bind(db());
    vi.spyOn(db(), 'rpc').mockImplementation(((name: string, args: never) =>
      name === 'agent_rate_limit' ? Promise.resolve({ data: null, error: dbError }) : real(name, args)) as never);
    await expect503(await refresh(pair.refresh));
  });

  it('when something throws', async () => {
    const user = await createUser('dberr5');
    const { pair } = await connect(user);
    vi.spyOn(db(), 'from').mockImplementation((() => {
      throw new Error('socket hang up');
    }) as never);
    await expect503(await refresh(pair.refresh));
  });

  it('when the function answers something it should not', async () => {
    const user = await createUser('dberr6');
    const { pair } = await connect(user);
    const real = db().rpc.bind(db());
    vi.spyOn(db(), 'rpc').mockImplementation(((name: string, args: never) =>
      name === 'oauth_refresh' ? Promise.resolve({ data: { status: 'mystery' }, error: null }) : real(name, args)) as never);
    await expect503(await refresh(pair.refresh));
  });
});

describe('rate limits', () => {
  it('allows 60 requests a minute per grant, then 429 with Retry-After', async () => {
    const user = await createUser('limit');
    const { pair } = await connect(user);
    for (let i = 0; i < 60; i++) expect((await refresh(pair.refresh)).status, `request ${i + 1}`).toBe(200);
    const limited = await refresh(pair.refresh);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  }, 60_000);

  it('answers 429 to an address that keeps failing before any grant is known, and not to others', async () => {
    const ip = randomIp();
    const bad = () =>
      token(formRequest('/api/oauth/token', { grant_type: 'refresh_token', client_id: CLAUDE_CODE_CLIENT_ID, refresh_token: 'nope' }, { 'x-real-ip': ip }));
    for (let i = 0; i < 30; i++) expect((await bad()).status).toBe(400);
    const limited = await bad();
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    expect((await refresh('nope')).status).toBe(400);
  });

  it('never counts a request that names a real grant against the address', async () => {
    const user = await createUser('ipok');
    const { pair } = await connect(user);
    const ip = randomIp();
    for (let i = 0; i < 35; i++) {
      const res = await token(formRequest('/api/oauth/token', { grant_type: 'refresh_token', client_id: CLAUDE_CODE_CLIENT_ID, refresh_token: pair.refresh }, { 'x-real-ip': ip }));
      expect(res.status).toBe(200);
    }
  });
});
