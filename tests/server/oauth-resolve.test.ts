import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { generateAgentToken } from '@/lib/agent-tokens';
import { resolveOAuthAccessToken } from '@/lib/oauth/resolve';
import { generateOAuthTokenPair, hashOAuthSecret } from '@/lib/oauth/tokens';
import { createUser, db, sql } from './helpers/db';
import { TEST_PEPPER, callApprove, callRefresh, connect, enableOAuth, seedRequest } from './helpers/oauth-server';

let restore: () => void;
beforeAll(() => {
  restore = enableOAuth();
});
afterAll(() => restore());
afterEach(() => vi.restoreAllMocks());

describe('resolveOAuthAccessToken', () => {
  it('resolves a live grant\'s access token to the Actor, with the grant as the token id', async () => {
    const user = await createUser('res');
    const { pair, grantId } = await connect(user, { scopes: ['read', 'bills:write'] });
    expect(await resolveOAuthAccessToken(pair.access)).toEqual({
      ok: true,
      actor: { userId: user.id, tokenId: grantId, scopes: ['read', 'bills:write'] },
      suspended: false,
    });
  });

  it('is malformed, without asking the database, for anything that is not an access token of ours', async () => {
    const user = await createUser('res2');
    const { pair } = await connect(user);
    const from = vi.spyOn(db(), 'from');
    for (const value of [pair.refresh, generateAgentToken().token, `${pair.access}x`, 'spl_oat_', '', undefined, null, 5, pair.access.slice(0, -1) + (pair.access.endsWith('A') ? 'B' : 'A')]) {
      expect(await resolveOAuthAccessToken(value), String(value)).toEqual({ ok: false, reason: 'malformed' });
    }
    // a well-formed token minted under another pepper is forged too
    expect(await resolveOAuthAccessToken(generateOAuthTokenPair('x'.repeat(40)).access)).toEqual({ ok: false, reason: 'malformed' });
    expect(from).not.toHaveBeenCalled();
  });

  it('is unknown for a well-formed token nobody holds', async () => {
    expect(await resolveOAuthAccessToken(generateOAuthTokenPair(TEST_PEPPER).access)).toEqual({ ok: false, reason: 'unknown' });
  });

  it('is expired when the access token or the grant ran out', async () => {
    const user = await createUser('res3');
    const a = await connect(user);
    await sql(`update public.agent_oauth_tokens set expires_at = now() - interval '1 second' where hash = $1`, [hashOAuthSecret(a.pair.access)]);
    expect(await resolveOAuthAccessToken(a.pair.access)).toEqual({ ok: false, reason: 'expired' });
    const b = await connect(user);
    await sql(`update public.agent_tokens set expires_at = now() - interval '1 second' where id = $1`, [b.grantId]);
    expect(await resolveOAuthAccessToken(b.pair.access)).toEqual({ ok: false, reason: 'expired' });
  });

  it('stops working the moment the grant is revoked, by any path', async () => {
    const user = await createUser('res4');
    const a = await connect(user);
    await db().from('agent_tokens').update({ revoked_at: new Date().toISOString(), revoked_reason: 'user' }).eq('id', a.grantId);
    expect((await resolveOAuthAccessToken(a.pair.access)).ok).toBe(false);
  });

  it('refuses a token of a revoked grant even if its row survived (the join is the guarantee)', async () => {
    const user = await createUser('res5');
    const { grantId } = await connect(user);
    await db().from('agent_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', grantId);
    const stray = generateOAuthTokenPair(TEST_PEPPER).access;
    await db().from('agent_oauth_tokens').insert({ hash: hashOAuthSecret(stray), type: 'access', grant_id: grantId, expires_at: new Date(Date.now() + 3600_000).toISOString() });
    expect(await resolveOAuthAccessToken(stray)).toEqual({ ok: false, reason: 'revoked' });
  });

  it('gives no access through a pending grant, even with a token row attached', async () => {
    const user = await createUser('res6');
    const { result } = await callApprove(user, await seedRequest(user));
    const stray = generateOAuthTokenPair(TEST_PEPPER).access;
    await db().from('agent_oauth_tokens').insert({ hash: hashOAuthSecret(stray), type: 'access', grant_id: result.grant_id, expires_at: new Date(Date.now() + 3600_000).toISOString() });
    expect(await resolveOAuthAccessToken(stray)).toEqual({ ok: false, reason: 'unknown' });
  });

  it('reports a suspended grant as authenticated but suspended, with the reason', async () => {
    const user = await createUser('res7');
    const { pair, grantId } = await connect(user);
    await db().from('agent_tokens').update({ suspended_at: new Date().toISOString(), suspended_reason: 'too many refusals' }).eq('id', grantId);
    expect(await resolveOAuthAccessToken(pair.access)).toMatchObject({ ok: true, suspended: true, detail: 'too many refusals', actor: { tokenId: grantId } });
  });

  it('keeps working after a refresh: old and new access tokens both live until they expire', async () => {
    const user = await createUser('res8');
    const { pair } = await connect(user);
    const { next } = await callRefresh(pair.refresh);
    expect((await resolveOAuthAccessToken(pair.access)).ok).toBe(true);
    expect((await resolveOAuthAccessToken(next.access)).ok).toBe(true);
  });

  it('is unavailable, never unknown or revoked, when the database cannot answer', async () => {
    const user = await createUser('res9');
    const { pair } = await connect(user);
    vi.spyOn(db(), 'from').mockImplementation((() => {
      throw new Error('socket hang up');
    }) as never);
    expect(await resolveOAuthAccessToken(pair.access)).toEqual({ ok: false, reason: 'unavailable' });
    vi.restoreAllMocks();
    const builder: Record<string, unknown> = {};
    for (const name of ['select', 'eq']) builder[name] = () => builder;
    builder.maybeSingle = async () => ({ data: null, error: { message: 'down', code: '57P01' } });
    vi.spyOn(db(), 'from').mockImplementation((() => builder) as never);
    expect(await resolveOAuthAccessToken(pair.access)).toEqual({ ok: false, reason: 'unavailable' });
  });
});
