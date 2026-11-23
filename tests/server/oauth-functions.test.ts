import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { hmacEmailCode } from '@/lib/agent-tokens';
import { callMint } from './helpers/agent';
import { insertProposal, insertToken, seedPending, billExists } from './helpers/agent';
import { generateOAuthTokenPair } from '@/lib/oauth/tokens';
import { createUser, db, sql } from './helpers/db';
import {
  CLAUDE_CODE_CLIENT_ID,
  HOSTED_CLIENT_ID,
  TEST_PEPPER,
  callApprove,
  callRedeem,
  callRefresh,
  connect,
  grantRow,
  newBinding,
  oauthCodes,
  oauthTokens,
  seedRequest,
  sha,
} from './helpers/oauth-server';

// The SQL functions behind the OAuth server, called directly with no route in
// between. These are the security-critical parts: single-use codes, token
// rotation, reuse detection, caps and revocation.

describe('oauth_approve_request', () => {
  it('creates a pending grant and a code, and marks the request approved', async () => {
    const user = await createUser('approve');
    const req = await seedRequest(user);
    const { result, code } = await callApprove(user, req, { scopes: ['read', 'bills:write'] });
    expect(result.status).toBe('ok');

    const grant = await grantRow(result.grant_id!);
    expect(grant).toMatchObject({
      kind: 'oauth',
      oauth_status: 'pending',
      oauth_client_id: CLAUDE_CODE_CLIENT_ID,
      oauth_destination: 'loopback',
      token_hash: null,
      last4: null,
      scopes: ['read', 'bills:write'],
      revoked_at: null,
    });
    // pending: dies with its code, never a 90 day grant yet
    expect(new Date(grant.expires_at).getTime() - Date.now()).toBeLessThan(6 * 60_000);

    const codes = await oauthCodes(result.grant_id!);
    expect(codes).toHaveLength(1);
    expect(codes[0]).toMatchObject({ hash: sha(code), used_at: null, scopes: ['read', 'bills:write'], client_id: CLAUDE_CODE_CLIENT_ID });
    expect(JSON.stringify(codes)).not.toContain(code);

    const { data: request } = await db().from('agent_oauth_requests').select('status, grant_id').eq('id', req.id).single();
    expect(request).toMatchObject({ status: 'approved', grant_id: result.grant_id });
    expect(await oauthTokens(result.grant_id!)).toHaveLength(0);
  });

  it('answers not_found for another user, a wrong binding, an unowned, decided or missing request', async () => {
    const owner = await createUser('own');
    const other = await createUser('other');
    const req = await seedRequest(owner);
    expect((await callApprove(owner, req, { user: other })).result.status).toBe('not_found');
    expect((await callApprove(owner, req, { binding: newBinding() })).result.status).toBe('not_found');
    expect((await callApprove(owner, await seedRequest(null))).result.status).toBe('not_found');
    expect((await callApprove(owner, await seedRequest(owner, { status: 'denied' }))).result.status).toBe('not_found');
    expect((await callApprove(owner, { id: 'A'.repeat(22), binding: 'x', clientId: CLAUDE_CODE_CLIENT_ID })).result.status).toBe('not_found');
    expect((await callApprove(owner, req)).result.status).toBe('ok');
    // approving twice cannot make a second grant
    expect((await callApprove(owner, req)).result.status).toBe('not_found');
    const { data } = await db().from('agent_tokens').select('id').eq('user_id', owner.id);
    expect(data).toHaveLength(1);
  });

  it('refuses an expired request and bad scopes', async () => {
    const user = await createUser('exp');
    expect((await callApprove(user, await seedRequest(user, { expiresAt: new Date(Date.now() - 1000) }))).result.status).toBe('expired');
    for (const scopes of [[], ['bills:write'], ['read', 'admin'], ['admin']]) {
      expect((await callApprove(user, await seedRequest(user), { scopes })).result.status).toBe('invalid_input');
    }
  });

  it('allows several live grants for one client, up to five, and counts live ones only', async () => {
    const user = await createUser('cap');
    for (let i = 0; i < 5; i++) await connect(user);
    expect((await callApprove(user, await seedRequest(user))).result.status).toBe('grant_limit');
    // another client does not get around the cap
    expect((await callApprove(user, await seedRequest(user, { clientId: HOSTED_CLIENT_ID }))).result.status).toBe('grant_limit');
  });

  it('does not count personal tokens toward the OAuth cap, nor OAuth grants toward the personal cap', async () => {
    const user = await createUser('sep');
    for (let i = 0; i < 5; i++) await insertToken(user);
    expect((await callApprove(user, await seedRequest(user))).result.status).toBe('ok');

    const user2 = await createUser('sep2');
    for (let i = 0; i < 5; i++) await connect(user2);
    await seedPending(user2, { code: '123456' });
    expect((await callMint(user2, '123456')).result.status).toBe('ok');
  });

  it('a pending grant does not count toward the cap', async () => {
    const user = await createUser('pendcap');
    for (let i = 0; i < 4; i++) await connect(user);
    expect((await callApprove(user, await seedRequest(user))).result.status).toBe('ok');
    expect((await callApprove(user, await seedRequest(user))).result.status).toBe('ok');
  });

  it('replace lets an account at the cap connect again, and revokes nothing until redemption', async () => {
    const user = await createUser('repl');
    const first = await connect(user, { clientId: HOSTED_CLIENT_ID });
    for (let i = 0; i < 4; i++) await connect(user);
    const { result, code } = await callApprove(user, await seedRequest(user, { clientId: HOSTED_CLIENT_ID }), {
      replace: true,
      destination: 'claude.ai',
    });
    expect(result.status).toBe('ok');
    expect(result.replaces).toBe(1);
    expect((await grantRow(first.grantId)).revoked_at).toBeNull();
    expect((await oauthTokens(first.grantId)).length).toBe(2);

    expect((await callRedeem(code)).result.status).toBe('ok');
    expect(await grantRow(first.grantId)).toMatchObject({ revoked_reason: 'replaced' });
    expect(await oauthTokens(first.grantId)).toHaveLength(0);
  });
});

describe('oauth_approve_request: the emailed code', () => {
  const hmac = (userId: string, code: string) => hmacEmailCode('p'.repeat(40), userId, `oauth:x:${code}`);

  it('is required when asked for: missing, expired and wrong codes are refused', async () => {
    const user = await createUser('code');
    const future = new Date(Date.now() + 600_000);
    const req = await seedRequest(user, { codeHmac: hmac(user.id, '111111'), codeExpiresAt: future });

    expect((await callApprove(user, req, { requireCode: true, codeHmac: null })).result.status).toBe('code_required');
    const noCodeSent = await seedRequest(user);
    expect((await callApprove(user, noCodeSent, { requireCode: true, codeHmac: hmac(user.id, '111111') })).result.status).toBe('code_required');
    const expired = await seedRequest(user, { codeHmac: hmac(user.id, '111111'), codeExpiresAt: new Date(Date.now() - 1000) });
    expect((await callApprove(user, expired, { requireCode: true, codeHmac: hmac(user.id, '111111') })).result.status).toBe('code_required');

    const wrong = await callApprove(user, req, { requireCode: true, codeHmac: hmac(user.id, '222222') });
    expect(wrong.result).toMatchObject({ status: 'wrong_code', attempts_left: 4 });
    const { data } = await db().from('agent_tokens').select('id').eq('user_id', user.id);
    expect(data).toHaveLength(0);

    const right = await callApprove(user, req, { requireCode: true, codeHmac: hmac(user.id, '111111') });
    expect(right.result.status).toBe('ok');
    // the code is single use: the request is decided now
    expect((await callApprove(user, req, { requireCode: true, codeHmac: hmac(user.id, '111111') })).result.status).toBe('not_found');
  });

  it('allows five attempts per code, then too_many_attempts even for the right one', async () => {
    const user = await createUser('five');
    const req = await seedRequest(user, { codeHmac: hmac(user.id, '111111'), codeExpiresAt: new Date(Date.now() + 600_000) });
    const left: (number | undefined)[] = [];
    for (let i = 0; i < 5; i++) {
      left.push((await callApprove(user, req, { requireCode: true, codeHmac: hmac(user.id, '000000') })).result.attempts_left);
    }
    expect(left).toEqual([4, 3, 2, 1, 0]);
    expect((await callApprove(user, req, { requireCode: true, codeHmac: hmac(user.id, '111111') })).result.status).toBe('too_many_attempts');
  });

  it('counts wrong codes toward the 24 hour lock shared with personal tokens', async () => {
    const user = await createUser('lock');
    for (let i = 0; i < 10; i++) {
      const req = await seedRequest(user, { codeHmac: hmac(user.id, '111111'), codeExpiresAt: new Date(Date.now() + 600_000) });
      expect((await callApprove(user, req, { requireCode: true, codeHmac: hmac(user.id, '000000') })).result.status).toBe('wrong_code');
    }
    const locked = await callApprove(
      user,
      await seedRequest(user, { codeHmac: hmac(user.id, '111111'), codeExpiresAt: new Date(Date.now() + 600_000) }),
      { requireCode: true, codeHmac: hmac(user.id, '111111') }
    );
    expect(locked.result.status).toBe('locked');
    // the same lock stops personal tokens
    await seedPending(user, { code: '123456' });
    expect((await callMint(user, '123456')).result.status).toBe('locked');
    // and signing in clears both (the callback deletes the row)
    await db().from('agent_mint_state').delete().eq('user_id', user.id);
    expect((await callApprove(user, await seedRequest(user))).result.status).toBe('ok');
  });

  it('is not needed when the app says a fresh sign-in is enough', async () => {
    const user = await createUser('fresh');
    expect((await callApprove(user, await seedRequest(user), { requireCode: false })).result.status).toBe('ok');
  });
});

describe('oauth_approve_request: the hosted client (defence in depth)', () => {
  it('refuses p_require_code = false for the hosted client, whatever the request holds', async () => {
    const user = await createUser('hostedfn');
    const req = await seedRequest(user, { clientId: HOSTED_CLIENT_ID, codeHmac: 'h', codeExpiresAt: new Date(Date.now() + 60_000) });
    const refused = await callApprove(user, req, { requireCode: false, destination: 'claude.ai' });
    expect(refused.result.status).toBe('code_required');
    expect((await db().from('agent_tokens').select('id').eq('user_id', user.id)).data).toEqual([]);
    expect((await db().from('agent_oauth_requests').select('status').eq('id', req.id).single()).data!.status).toBe('pending');
    // with the code it goes through
    const ok = await callApprove(user, req, { requireCode: true, codeHmac: 'h', destination: 'claude.ai' });
    expect(ok.result.status).toBe('ok');
  });

  it('still lets Claude Code through without a code when the app says a fresh sign-in was enough', async () => {
    const user = await createUser('codefn');
    const req = await seedRequest(user, { clientId: CLAUDE_CODE_CLIENT_ID });
    expect((await callApprove(user, req, { requireCode: false })).result.status).toBe('ok');
  });
});

describe('oauth_redeem_code', () => {
  it('makes the grant live for 90 days and issues the first token pair, stored hashed', async () => {
    const user = await createUser('redeem');
    const req = await seedRequest(user);
    const { result: approved, code } = await callApprove(user, req, { scopes: ['read', 'bills:write'] });
    const { result, pair } = await callRedeem(code);
    expect(result).toMatchObject({ status: 'ok', grant_id: approved.grant_id, user_id: user.id, scopes: ['read', 'bills:write'] });

    const grant = await grantRow(approved.grant_id!);
    expect(grant.oauth_status).toBe('live');
    const days = (new Date(grant.expires_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(89.99);
    expect(days).toBeLessThan(90.01);

    const tokens = await oauthTokens(approved.grant_id!);
    expect(tokens.map((t) => t.type).sort()).toEqual(['access', 'refresh']);
    const access = tokens.find((t) => t.type === 'access')!;
    const refresh = tokens.find((t) => t.type === 'refresh')!;
    expect(access.hash).toBe(sha(pair.access));
    expect(refresh.hash).toBe(sha(pair.refresh));
    expect(JSON.stringify(tokens)).not.toContain(pair.access);
    const hours = (new Date(access.expires_at).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(0.99);
    expect(hours).toBeLessThan(1.01);
    expect(new Date(refresh.expires_at).getTime()).toBe(new Date(grant.expires_at).getTime());
    expect(refresh.rotated_at).toBeNull();
  });

  it('does not consume the code when a binding check failed, and a valid exchange still works', async () => {
    const user = await createUser('binding');
    const { result: approved, code } = await callApprove(user, await seedRequest(user));
    expect((await callRedeem(code, false)).result.status).toBe('invalid');
    expect((await grantRow(approved.grant_id!)).oauth_status).toBe('pending');
    expect((await callRedeem(code, true)).result.status).toBe('ok');
  });

  it('answers not_found for an unknown code and expired for an old one', async () => {
    const user = await createUser('unknown');
    expect((await callRedeem('A'.repeat(43))).result.status).toBe('not_found');
    const { code } = await callApprove(user, await seedRequest(user));
    await sql(`update public.agent_oauth_codes set expires_at = now() - interval '1 second' where hash = $1`, [sha(code)]);
    expect((await callRedeem(code)).result.status).toBe('expired');
  });

  it('revokes the grant when a used code is replayed with correct bindings', async () => {
    const user = await createUser('replay');
    const { result: approved, code } = await callApprove(user, await seedRequest(user));
    const first = await callRedeem(code);
    expect(first.result.status).toBe('ok');
    // A retry inside 120 s is idempotent (below); after that the same call is a replay
    await sql(`update public.agent_oauth_codes set used_at = now() - interval '121 seconds' where hash = $1`, [sha(code)]);
    const replay = await callRedeem(code, true);
    expect(replay.result).toMatchObject({ status: 'replayed', grant_id: approved.grant_id });
    expect(await grantRow(approved.grant_id!)).toMatchObject({ revoked_reason: 'code_replay' });
    expect(await oauthTokens(approved.grant_id!)).toHaveLength(0);
    // and the tokens it had issued no longer refresh
    expect((await callRefresh(first.pair.refresh)).result.status).toBe('not_found');
  });

  it('treats a replay that fails the bindings as plain invalid and leaves the grant alone', async () => {
    const user = await createUser('replay2');
    const { result: approved, code } = await callApprove(user, await seedRequest(user));
    await callRedeem(code);
    expect((await callRedeem(code, false)).result.status).toBe('invalid');
    expect((await grantRow(approved.grant_id!)).revoked_at).toBeNull();
    expect(await oauthTokens(approved.grant_id!)).toHaveLength(2);
  });

  it('answers a retry within 120 s with the same pair and leaves the grant live (idempotent)', async () => {
    const user = await createUser('retry');
    const { result: approved, code } = await callApprove(user, await seedRequest(user));
    const first = await callRedeem(code);
    const again = await callRedeem(code);
    expect(again.pair).toEqual(first.pair);
    expect(again.result).toMatchObject({ status: 'ok', replay: true, grant_id: approved.grant_id, scopes: ['read'] });
    expect(await grantRow(approved.grant_id!)).toMatchObject({ revoked_at: null, oauth_status: 'live' });
    expect((await oauthTokens(approved.grant_id!)).map((t) => t.hash).sort()).toEqual([sha(first.pair.access), sha(first.pair.refresh)].sort());
  });

  it('ties the first pair to its code: parent_hash is the code hash', async () => {
    const user = await createUser('parent');
    const { result: approved, code } = await callApprove(user, await seedRequest(user));
    await callRedeem(code);
    expect((await oauthTokens(approved.grant_id!)).map((t) => t.parent_hash)).toEqual([sha(code), sha(code)]);
  });

  it('revokes on a retry after the first pair was used: refreshed, or used at /api/mcp', async () => {
    for (const how of ['refreshed', 'called'] as const) {
      const user = await createUser(`used-${how}`);
      const { result: approved, code } = await callApprove(user, await seedRequest(user));
      const first = await callRedeem(code);
      if (how === 'refreshed') expect((await callRefresh(first.pair.refresh)).result.status).toBe('ok');
      else await sql(`update public.agent_tokens set last_used_at = now() where id = $1`, [approved.grant_id]);
      const retry = await callRedeem(code);
      expect(retry.result.status, how).toBe('replayed');
      expect(await grantRow(approved.grant_id!), how).toMatchObject({ revoked_reason: 'code_replay' });
    }
  });

  it('revokes on a retry that comes back with a different pair (it was not derived from this code)', async () => {
    const user = await createUser('otherpair');
    const { result: approved, code } = await callApprove(user, await seedRequest(user));
    await callRedeem(code);
    const retry = await callRedeem(code, true, generateOAuthTokenPair(TEST_PEPPER));
    expect(retry.result.status).toBe('replayed');
    expect((await grantRow(approved.grant_id!)).revoked_reason).toBe('code_replay');
  });

  it('a retry whose bindings fail never revokes, even inside the window', async () => {
    const user = await createUser('retrywrong');
    const { result: approved, code } = await callApprove(user, await seedRequest(user));
    await callRedeem(code);
    expect((await callRedeem(code, false)).result.status).toBe('invalid');
    expect((await grantRow(approved.grant_id!)).revoked_at).toBeNull();
  });

  it('parallel redemptions all get the same pair, and the grant stays live', async () => {
    const user = await createUser('race');
    const { result: approved, code } = await callApprove(user, await seedRequest(user));
    const results = await Promise.all(Array.from({ length: 6 }, () => callRedeem(code)));
    expect(results.every((r) => r.result.status === 'ok')).toBe(true);
    expect(results.filter((r) => r.result.replay === false)).toHaveLength(1);
    expect(new Set(results.map((r) => r.pair.access)).size).toBe(1);
    expect(await grantRow(approved.grant_id!)).toMatchObject({ revoked_at: null, oauth_status: 'live' });
    expect(await oauthTokens(approved.grant_id!)).toHaveLength(2);
  });

  it('keeps the proposals of a replaced grant, deletes none', async () => {
    const user = await createUser('keep');
    const old = await connect(user, { clientId: HOSTED_CLIENT_ID });
    const proposal = await insertProposal(user, old.grantId);
    const { code } = await callApprove(user, await seedRequest(user, { clientId: HOSTED_CLIENT_ID }), {
      replace: true,
      destination: 'claude.ai',
    });
    expect((await callRedeem(code)).result.status).toBe('ok');
    expect((await grantRow(old.grantId)).revoked_reason).toBe('replaced');
    expect(await billExists(proposal)).toBe(true);
  });

  it('does not replace anything when the redemption fails, and re-checks the cap', async () => {
    const user = await createUser('cap2');
    const old = await connect(user, { clientId: HOSTED_CLIENT_ID });
    for (let i = 0; i < 3; i++) await connect(user);
    // two approvals pass the cap check together (4 live), only one fits
    const a = await callApprove(user, await seedRequest(user));
    const b = await callApprove(user, await seedRequest(user));
    expect(a.result.status).toBe('ok');
    expect(b.result.status).toBe('ok');
    expect((await callRedeem(a.code)).result.status).toBe('ok');
    const late = await callRedeem(b.code);
    expect(late.result.status).toBe('grant_limit');
    expect((await grantRow(b.result.grant_id!)).revoked_reason).toBe('grant_limit');
    expect((await grantRow(old.grantId)).revoked_at).toBeNull();

    // a failed (expired) redemption leaves the grant it would have replaced alone
    const c = await callApprove(user, await seedRequest(user, { clientId: HOSTED_CLIENT_ID }), { replace: true, destination: 'claude.ai' });
    await sql(`update public.agent_oauth_codes set expires_at = now() - interval '1 second' where hash = $1`, [sha(c.code)]);
    expect((await callRedeem(c.code)).result.status).toBe('expired');
    expect((await grantRow(old.grantId)).revoked_at).toBeNull();
  });
});

describe('oauth_refresh', () => {
  it('rotates on first use: successors are stored, the old refresh token is marked rotated', async () => {
    const user = await createUser('rot');
    const { grantId, pair } = await connect(user);
    const { result, next } = await callRefresh(pair.refresh);
    expect(result).toMatchObject({ status: 'ok', replay: false, grant_id: grantId, user_id: user.id });
    const tokens = await oauthTokens(grantId);
    expect(tokens).toHaveLength(4);
    const old = tokens.find((t) => t.hash === sha(pair.refresh))!;
    expect(old.rotated_at).not.toBeNull();
    const succ = tokens.find((t) => t.hash === sha(next.refresh))!;
    expect(succ).toMatchObject({ type: 'refresh', parent_hash: sha(pair.refresh), rotated_at: null });
    expect(tokens.find((t) => t.hash === sha(next.access))).toMatchObject({ type: 'access', parent_hash: sha(pair.refresh) });
  });

  it('returns the same pair to a replay inside the grace window, any number of times', async () => {
    const user = await createUser('grace');
    const { grantId, pair } = await connect(user);
    const first = await callRefresh(pair.refresh);
    const again = await callRefresh(pair.refresh);
    const third = await callRefresh(pair.refresh);
    expect(first.result.replay).toBe(false);
    expect(again.result).toMatchObject({ status: 'ok', replay: true });
    expect(third.result).toMatchObject({ status: 'ok', replay: true });
    expect(again.next).toEqual(first.next);
    expect(await oauthTokens(grantId)).toHaveLength(4);
    expect((await grantRow(grantId)).revoked_at).toBeNull();
  });

  it('gives the same pair to parallel refreshes with one token', async () => {
    const user = await createUser('prace');
    const { grantId, pair } = await connect(user);
    const results = await Promise.all(Array.from({ length: 8 }, () => callRefresh(pair.refresh)));
    expect(results.every((r) => r.result.status === 'ok')).toBe(true);
    expect(results.filter((r) => r.result.replay === false)).toHaveLength(1);
    expect(new Set(results.map((r) => r.next.refresh)).size).toBe(1);
    expect(await oauthTokens(grantId)).toHaveLength(4);
  });

  it('revokes the grant on a replay after the 120 second window', async () => {
    const user = await createUser('late');
    const { grantId, pair } = await connect(user);
    await callRefresh(pair.refresh);
    await sql(`update public.agent_oauth_tokens set rotated_at = now() - interval '121 seconds' where hash = $1`, [sha(pair.refresh)]);
    const reuse = await callRefresh(pair.refresh);
    expect(reuse.result).toMatchObject({ status: 'reuse', grant_id: grantId, user_id: user.id });
    expect(await grantRow(grantId)).toMatchObject({ revoked_reason: 'refresh_reuse' });
    expect(await oauthTokens(grantId)).toHaveLength(0);
    // the successor is dead too
    expect((await callRefresh(reuse.next.refresh)).result.status).toBe('not_found');
  });

  it('still honours a replay at 119 seconds', async () => {
    const user = await createUser('edge');
    const { pair } = await connect(user);
    await callRefresh(pair.refresh);
    await sql(`update public.agent_oauth_tokens set rotated_at = now() - interval '119 seconds' where hash = $1`, [sha(pair.refresh)]);
    expect((await callRefresh(pair.refresh)).result).toMatchObject({ status: 'ok', replay: true });
  });

  it('revokes the grant when the old token is replayed after its successor was used', async () => {
    const user = await createUser('used');
    const { grantId, pair } = await connect(user);
    const first = await callRefresh(pair.refresh);
    expect((await callRefresh(first.next.refresh)).result.status).toBe('ok');
    const reuse = await callRefresh(pair.refresh);
    expect(reuse.result.status).toBe('reuse');
    expect((await grantRow(grantId)).revoked_at).not.toBeNull();
  });

  it('treats a replay whose derived successors differ from the stored ones as reuse', async () => {
    const user = await createUser('differ');
    const { pair } = await connect(user);
    await callRefresh(pair.refresh);
    const { data } = await db().rpc('oauth_refresh', {
      p_refresh_hash: sha(pair.refresh),
      p_client_id: CLAUDE_CODE_CLIENT_ID,
      p_new_access_hash: sha('other-access'),
      p_new_refresh_hash: sha('other-refresh'),
    });
    expect(data.status).toBe('reuse');
  });

  it('refuses another client, an expired grant or token, a revoked grant and unknown tokens', async () => {
    const user = await createUser('refuse');
    const a = await connect(user);
    expect((await callRefresh(a.pair.refresh, HOSTED_CLIENT_ID)).result.status).toBe('client_mismatch');
    expect(await oauthTokens(a.grantId)).toHaveLength(2);

    const b = await connect(user);
    await sql(`update public.agent_tokens set expires_at = now() - interval '1 second' where id = $1`, [b.grantId]);
    expect((await callRefresh(b.pair.refresh)).result.status).toBe('expired');

    const c = await connect(user);
    await db().from('agent_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', c.grantId);
    expect((await callRefresh(c.pair.refresh)).result.status).toBe('not_found');

    expect((await callRefresh('spl_ort_' + 'A'.repeat(43) + '_AAAAAAAA')).result.status).toBe('not_found');
    // an access token is not a refresh token
    expect((await callRefresh(a.pair.access)).result.status).toBe('not_found');
  });

  it('still refreshes a suspended grant', async () => {
    const user = await createUser('susp');
    const { grantId, pair } = await connect(user);
    await db().from('agent_tokens').update({ suspended_at: new Date().toISOString(), suspended_reason: 'test' }).eq('id', grantId);
    expect((await callRefresh(pair.refresh)).result.status).toBe('ok');
  });

  it('does not refresh a pending grant (no tokens exist for it)', async () => {
    const user = await createUser('pend');
    const { result } = await callApprove(user, await seedRequest(user));
    expect(await oauthTokens(result.grant_id!)).toHaveLength(0);
  });
});

describe('oauth_revoke_by_token and the revoke trigger', () => {
  it('revokes the grant from either token of the right client', async () => {
    const user = await createUser('rev');
    for (const which of ['access', 'refresh'] as const) {
      const { grantId, pair } = await connect(user);
      const { data } = await db().rpc('oauth_revoke_by_token', { p_token_hash: sha(pair[which]), p_client_id: CLAUDE_CODE_CLIENT_ID });
      expect(data).toMatchObject({ status: 'revoked', grant_id: grantId });
      expect(await grantRow(grantId)).toMatchObject({ revoked_reason: 'oauth_revoked' });
      expect(await oauthTokens(grantId)).toHaveLength(0);
    }
  });

  it('ignores unknown tokens and tokens of another client', async () => {
    const user = await createUser('rev2');
    const { grantId, pair } = await connect(user);
    const wrongClient = await db().rpc('oauth_revoke_by_token', { p_token_hash: sha(pair.access), p_client_id: HOSTED_CLIENT_ID });
    expect(wrongClient.data.status).toBe('not_found');
    const unknown = await db().rpc('oauth_revoke_by_token', { p_token_hash: sha('nope'), p_client_id: CLAUDE_CODE_CLIENT_ID });
    expect(unknown.data.status).toBe('not_found');
    expect((await grantRow(grantId)).revoked_at).toBeNull();
  });

  it('deletes a grant\'s tokens and codes whenever revoked_at is set, by any path', async () => {
    const user = await createUser('trig');
    const { grantId } = await connect(user);
    const { code } = await callApprove(user, await seedRequest(user));
    expect(await oauthTokens(grantId)).toHaveLength(2);
    const pendingGrant = (await db().from('agent_oauth_codes').select('grant_id').eq('hash', sha(code)).single()).data!.grant_id;
    // what the profile, revoke-all and the "not you?" link all do
    await db().from('agent_tokens').update({ revoked_at: new Date().toISOString(), revoked_reason: 'user' }).eq('user_id', user.id).is('revoked_at', null);
    expect(await oauthTokens(grantId)).toHaveLength(0);
    expect(await oauthCodes(pendingGrant)).toHaveLength(0);
  });

  it('leaves other grants and personal tokens alone', async () => {
    const user = await createUser('trig2');
    const a = await connect(user);
    const b = await connect(user);
    const pat = await insertToken(user);
    await db().from('agent_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', a.grantId);
    expect(await oauthTokens(b.grantId)).toHaveLength(2);
    expect((await grantRow(pat.id)).revoked_at).toBeNull();
  });
});

describe('prune_agent_access', () => {
  it('deletes expired requests, codes, tokens and never-redeemed pending grants, and keeps live ones', async () => {
    const user = await createUser('prune');
    const live = await connect(user);
    const abandoned = await callApprove(user, await seedRequest(user));
    const oldRequest = await seedRequest(user, { expiresAt: new Date(Date.now() - 2 * 86_400_000) });
    await sql(`update public.agent_tokens set expires_at = now() - interval '8 days' where id = $1`, [abandoned.result.grant_id]);
    await sql(`update public.agent_oauth_codes set expires_at = now() - interval '2 days' where grant_id = $1`, [abandoned.result.grant_id]);
    await sql(`update public.agent_oauth_tokens set expires_at = now() - interval '2 days' where hash = $1`, [sha(live.pair.access)]);

    await db().rpc('prune_agent_access');

    expect((await db().from('agent_tokens').select('id').eq('id', abandoned.result.grant_id!)).data).toHaveLength(0);
    expect(await oauthCodes(abandoned.result.grant_id!)).toHaveLength(0);
    expect((await db().from('agent_oauth_requests').select('id').eq('id', oldRequest.id)).data).toHaveLength(0);
    const remaining = await oauthTokens(live.grantId);
    expect(remaining.map((t) => t.type)).toEqual(['refresh']);
    expect((await grantRow(live.grantId)).oauth_status).toBe('live');
  });
});

describe('privileges', () => {
  const anon = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

  it('refuses every OAuth function to the public roles', async () => {
    const rows = await sql<{ fn: string; anon: boolean; authed: boolean; service: boolean }>(
      `select p.oid::regprocedure::text fn,
              has_function_privilege('anon', p.oid, 'EXECUTE') anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') authed,
              has_function_privilege('service_role', p.oid, 'EXECUTE') service
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and (p.proname like 'oauth\\_%' or p.proname in ('agent_register_wrong_code', 'agent_oauth_on_revoke'))`
    );
    expect(rows.length).toBe(6);
    for (const row of rows) {
      expect(row.anon, row.fn).toBe(false);
      expect(row.authed, row.fn).toBe(false);
      expect(row.service, row.fn).toBe(!/^(public\.)?(agent_register_wrong_code|agent_oauth_on_revoke)\(/.test(row.fn));
    }
  });

  it('runs the functions as definers with an empty search path', async () => {
    const rows = await sql<{ proname: string; secdef: boolean; config: string[] | null }>(
      `select p.proname, p.prosecdef secdef, p.proconfig config from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and (p.proname like 'oauth\\_%' or p.proname in ('agent_register_wrong_code', 'agent_oauth_on_revoke', 'mint_agent_token', 'prune_agent_access'))`
    );
    expect(rows.length).toBe(8);
    for (const row of rows) {
      expect(row.secdef, row.proname).toBe(true);
      expect(row.config, row.proname).toContain('search_path=""');
    }
  });

  it('has RLS on and nothing readable or writable for anon or authenticated', async () => {
    for (const table of ['agent_oauth_requests', 'agent_oauth_codes', 'agent_oauth_tokens']) {
      const rows = await sql<{ rls: boolean; anon: boolean; authed: boolean }>(
        `select c.relrowsecurity rls,
                has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') anon,
                has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') authed
         from pg_class c where c.relname = $1 and c.relnamespace = 'public'::regnamespace`,
        [table]
      );
      expect(rows[0]).toEqual({ rls: true, anon: false, authed: false });
      const read = await anon().from(table).select('*').limit(1);
      expect(read.error).not.toBeNull();
    }
    const call = await anon().rpc('oauth_redeem_code', { p_code_hash: 'x', p_bindings_ok: true, p_access_hash: 'a', p_refresh_hash: 'b' });
    expect(call.error).not.toBeNull();
  });

  it('keeps a personal token\'s shape: hash and last4 required, no OAuth columns', async () => {
    const user = await createUser('shape');
    const bad = await db().from('agent_tokens').insert({ user_id: user.id, name: 'x', scopes: ['read'], expires_at: new Date(Date.now() + 1e6).toISOString() });
    expect(bad.error).not.toBeNull();
    const bad2 = await db().from('agent_tokens').insert({
      user_id: user.id, name: 'x', scopes: ['read'], expires_at: new Date(Date.now() + 1e6).toISOString(),
      kind: 'oauth', oauth_client_id: 'c', oauth_destination: 'loopback', oauth_status: 'live', token_hash: 'h', last4: 'abcd',
    });
    expect(bad2.error).not.toBeNull();
  });
});
