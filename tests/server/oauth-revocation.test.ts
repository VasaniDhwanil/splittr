import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';

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

import { GET as listTokens } from '@/app/api/agent-tokens/route';
import { DELETE as revokeToken } from '@/app/api/agent-tokens/[id]/route';
import { POST as resumeToken } from '@/app/api/agent-tokens/[id]/resume/route';
import { POST as revokeAll } from '@/app/api/agent-tokens/revoke-all/route';
import { POST as revokeLink } from '@/app/api/agent-tokens/revoke-link/route';
import { POST as oauthRevoke } from '@/app/api/oauth/revoke/route';
import { POST as tokenEndpoint } from '@/app/api/oauth/token/route';
import { hashAgentToken } from '@/lib/agent-tokens';
import { resetFailures } from '@/lib/oauth/throttle';
import { billExists, insertProposal, insertToken } from './helpers/agent';
import { createUser, db, params, request } from './helpers/db';
import { callTool, rpcBody, send } from './helpers/mcp';
import {
  CLAUDE_CODE_CLIENT_ID,
  HOSTED_CLIENT_ID,
  callApprove,
  connect,
  enableOAuth,
  formRequest,
  grantRow,
  oauthTokens,
  seedRequest,
} from './helpers/oauth-server';
import { signInAs, signOut, type TestUser } from './helpers/session';

const ORIGIN = { origin: 'http://localhost:3000' };

let restore: () => void;
beforeAll(() => {
  restore = enableOAuth();
});
afterAll(() => restore());

let user: TestUser;
beforeEach(async () => {
  resetFailures();
  mail.sent.length = 0;
  signOut();
  user = await createUser('revocation');
});
afterEach(() => vi.restoreAllMocks());

const refresh = async (token: string, clientId = CLAUDE_CODE_CLIENT_ID) => {
  const res = await tokenEndpoint(formRequest('/api/oauth/token', { grant_type: 'refresh_token', refresh_token: token, client_id: clientId }));
  return { status: res.status, body: (await res.json()) as { error?: string; access_token?: string; refresh_token?: string } };
};

/** The next /api/mcp call with the grant's access token fails, and its refresh token is invalid_grant. */
async function expectDead(pair: { access: string; refresh: string }, grantId: string) {
  const res = await send(rpcBody('tools/list'), { token: pair.access });
  expect(res.status).toBe(401);
  expect(res.headers.get('www-authenticate')).toContain('error="invalid_token"');
  const again = await refresh(pair.refresh);
  expect(again.status).toBe(400);
  expect(again.body.error).toBe('invalid_grant');
  expect(await oauthTokens(grantId)).toHaveLength(0);
}

async function expectAlive(pair: { access: string }) {
  expect((await send(rpcBody('tools/list'), { token: pair.access })).status).toBe(200);
}

describe('every v1 revoke path kills an OAuth grant at once', () => {
  it('profile revoke: DELETE /api/agent-tokens/[id]', async () => {
    const { pair, grantId } = await connect(user);
    const other = await connect(user);
    const proposal = await insertProposal(user, grantId);
    signInAs(user);
    const res = await revokeToken(request('DELETE', `/api/agent-tokens/${grantId}`, { headers: ORIGIN }), params({ id: grantId }));
    expect(res.status).toBe(200);
    expect((await grantRow(grantId)).revoked_reason).toBe('user');
    expect(await billExists(proposal)).toBe(false);
    await expectDead(pair, grantId);
    await expectAlive(other.pair);
  });

  it("someone else's grant is a 404 and stays alive", async () => {
    const { pair, grantId } = await connect(user);
    const stranger = await createUser('stranger');
    signInAs(stranger);
    const res = await revokeToken(request('DELETE', `/api/agent-tokens/${grantId}`, { headers: ORIGIN }), params({ id: grantId }));
    expect(res.status).toBe(404);
    await expectAlive(pair);
  });

  it('revoke-all takes every grant and personal token', async () => {
    const a = await connect(user);
    const b = await connect(user, { clientId: HOSTED_CLIENT_ID });
    const pat = await insertToken(user);
    signInAs(user);
    const res = await revokeAll(request('POST', '/api/agent-tokens/revoke-all', { headers: ORIGIN }));
    expect(res.status).toBe(200);
    expect((await res.json()).revoked).toBe(3);
    await expectDead(a.pair, a.grantId);
    await expectDead(b.pair, b.grantId);
    expect((await send(rpcBody('tools/list'), { token: pat.token })).status).toBe(401);
  });

  it('the "Not you?" link in the connected email (the grant\'s own revoke_link_hash) revokes everything of the owner', async () => {
    const a = await connect(user);
    const b = await connect(user, { clientId: HOSTED_CLIENT_ID });
    const secret = randomBytes(32).toString('base64url');
    await db().from('agent_tokens').update({ revoke_link_hash: hashAgentToken(secret) }).eq('id', a.grantId);
    const proposal = await insertProposal(user, b.grantId);
    // no session: the link works for someone locked out
    const res = await revokeLink(request('POST', '/api/agent-tokens/revoke-link', { body: { secret }, headers: ORIGIN }));
    expect(res.status).toBe(200);
    expect((await res.json()).revoked).toBe(2);
    expect((await grantRow(a.grantId)).revoked_reason).toBe('revoke_link');
    expect(await billExists(proposal)).toBe(false);
    await expectDead(a.pair, a.grantId);
    await expectDead(b.pair, b.grantId);
  });

  it('the link of an account never revokes another account', async () => {
    const mine = await connect(user);
    const other = await createUser('bystander');
    const theirs = await connect(other);
    const secret = randomBytes(32).toString('base64url');
    await db().from('agent_tokens').update({ revoke_link_hash: hashAgentToken(secret) }).eq('id', mine.grantId);
    await revokeLink(request('POST', '/api/agent-tokens/revoke-link', { body: { secret }, headers: ORIGIN }));
    await expectAlive(theirs.pair);
  });

  it('a token sent in the URL: the grant is revoked and its refresh token is invalid_grant', async () => {
    const { pair, grantId } = await connect(user);
    await send(rpcBody('tools/list'), { url: `http://localhost:3000/api/mcp?access_token=${pair.access}` });
    expect((await grantRow(grantId)).revoked_reason).toBe('query_string');
    await expectDead(pair, grantId);
  });

  it('RFC 7009 revocation: next call 401, refresh invalid_grant', async () => {
    const { pair, grantId } = await connect(user);
    const res = await oauthRevoke(formRequest('/api/oauth/revoke', { token: pair.refresh, client_id: CLAUDE_CODE_CLIENT_ID }));
    expect(res.status).toBe(200);
    await expectDead(pair, grantId);
  });

  it('circuit breaker: a paused grant is refused with 403 but still refreshes; resuming restores access', async () => {
    const writer = await connect(user, { scopes: ['read', 'bills:write'] });
    for (let i = 0; i < 5; i += 1) {
      await callTool(writer.pair.access, 'create_bill', { name: `n${i}`, items: [{ name: 'Yacht', price: 5000, quantity: 1 }] });
    }
    expect((await grantRow(writer.grantId)).suspended_at).not.toBeNull();
    expect(mail.sent.some((m) => /paused|stopped/i.test(m.subject))).toBe(true);
    expect((await send(rpcBody('tools/list'), { token: writer.pair.access })).status).toBe(403);

    // A suspended grant still refreshes (a new sign-in would bypass the breaker) ...
    const refreshed = await refresh(writer.pair.refresh);
    expect(refreshed.status).toBe(200);
    const next = { access: refreshed.body.access_token!, refresh: refreshed.body.refresh_token! };
    // ... but its tokens stay refused
    expect((await send(rpcBody('tools/list'), { token: next.access })).status).toBe(403);

    signInAs(user);
    const resumed = await resumeToken(request('POST', `/api/agent-tokens/${writer.grantId}/resume`, { headers: ORIGIN }), params({ id: writer.grantId }));
    expect(resumed.status).toBe(200);
    await expectAlive(next);
    // and a revoked grant cannot be resumed
    await revokeToken(request('DELETE', `/api/agent-tokens/${writer.grantId}`, { headers: ORIGIN }), params({ id: writer.grantId }));
    const again = await resumeToken(request('POST', `/api/agent-tokens/${writer.grantId}/resume`, { headers: ORIGIN }), params({ id: writer.grantId }));
    expect(again.status).toBe(404);
    await expectDead(next, writer.grantId);
  });
});

describe('GET /api/agent-tokens lists both kinds', () => {
  const list = async () => {
    signInAs(user);
    const res = await listTokens();
    expect(res.status).toBe(200);
    return (await res.json()) as { tokens: Record<string, unknown>[] };
  };

  it('adds kind and destination, with last4 null for OAuth rows and unchanged personal rows', async () => {
    const code = await connect(user);
    const hosted = await connect(user, { clientId: HOSTED_CLIENT_ID });
    const pat = await insertToken(user, { name: 'Mine' });
    const { tokens } = await list();
    const byId = (id: string) => tokens.find((t) => t.id === id)!;

    expect(byId(code.grantId)).toMatchObject({ kind: 'oauth', destination: 'loopback', last4: null, status: 'active', name: 'Claude Code', scopes: ['read'] });
    expect(byId(hosted.grantId)).toMatchObject({ kind: 'oauth', destination: 'claude.ai', last4: null, status: 'active' });
    expect(byId(pat.id)).toMatchObject({ kind: 'pat', status: 'active' });
    expect(typeof byId(pat.id).last4).toBe('string');
    expect(byId(pat.id)).not.toHaveProperty('destination');
    for (const row of tokens) {
      expect(Object.keys(row).sort()).toEqual(
        ['created_at', 'expires_at', 'id', 'kind', 'last4', 'last_used_at', 'last_used_ip', 'name', 'revoked_reason', 'scopes', 'status', 'suspended_reason']
          .concat(row.kind === 'oauth' ? ['destination'] : [])
          .sort()
      );
    }
    expect(JSON.stringify(tokens)).not.toMatch(/spl_o[ar]t_|hash/);
  });

  it('does not list a pending grant (approved, never redeemed), but lists it once redeemed', async () => {
    const req = await seedRequest(user);
    const { result } = await callApprove(user, req, { scopes: ['read'] });
    expect(result.status).toBe('ok');
    expect((await list()).tokens.map((t) => t.id)).not.toContain(result.grant_id);
    await db().from('agent_tokens').update({ oauth_status: 'live' }).eq('id', result.grant_id!);
    expect((await list()).tokens.map((t) => t.id)).toContain(result.grant_id);
  });

  it('shows active, suspended, expired and revoked OAuth grants by the same rules as personal tokens', async () => {
    const active = await connect(user);
    const suspended = await connect(user);
    const expired = await connect(user);
    const revoked = await connect(user);
    await db().from('agent_tokens').update({ suspended_at: new Date().toISOString(), suspended_reason: 'paused for a test' }).eq('id', suspended.grantId);
    await db().from('agent_tokens').update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq('id', expired.grantId);
    signInAs(user);
    await revokeToken(request('DELETE', `/api/agent-tokens/${revoked.grantId}`, { headers: ORIGIN }), params({ id: revoked.grantId }));

    const { tokens } = await list();
    const statusOf = (id: string) => tokens.find((t) => t.id === id)?.status;
    expect(statusOf(active.grantId)).toBe('active');
    expect(statusOf(suspended.grantId)).toBe('suspended');
    expect(statusOf(expired.grantId)).toBe('expired');
    expect(statusOf(revoked.grantId)).toBe('revoked');
    expect(tokens.find((t) => t.id === suspended.grantId)!.suspended_reason).toBe('paused for a test');
    expect(tokens.find((t) => t.id === revoked.grantId)!.revoked_reason).toBe('user');
  });

  it('never lists another account\'s grants', async () => {
    const mine = await connect(user);
    const other = await createUser('lister');
    const theirs = await connect(other);
    const ids = (await list()).tokens.map((t) => t.id);
    expect(ids).toContain(mine.grantId);
    expect(ids).not.toContain(theirs.grantId);
  });

  it('a pending grant cannot be resumed; a live one can', async () => {
    const req = await seedRequest(user);
    const { result } = await callApprove(user, req, { scopes: ['read'] });
    const id = result.grant_id!;
    await db().from('agent_tokens').update({ suspended_at: new Date().toISOString(), suspended_reason: 'x' }).eq('id', id);
    signInAs(user);
    const refused = await resumeToken(request('POST', `/api/agent-tokens/${id}/resume`, { headers: ORIGIN }), params({ id }));
    expect(refused.status).toBe(404);
    expect((await grantRow(id)).suspended_at).not.toBeNull();
    await db().from('agent_tokens').update({ oauth_status: 'live' }).eq('id', id);
    const ok = await resumeToken(request('POST', `/api/agent-tokens/${id}/resume`, { headers: ORIGIN }), params({ id }));
    expect(ok.status).toBe(200);
  });
});
