import { afterEach, describe, expect, it, vi } from 'vitest';
import * as admin from '@/lib/supabase/admin';
import { generateAgentToken, hashAgentToken } from '@/lib/agent-tokens';
import { hitRateLimit, isSameSiteOrigin, requestIp, resolveAgentToken, touchAgentToken } from '@/lib/agent-access';
import { insertToken } from './helpers/agent';
import { createUser, db } from './helpers/db';

afterEach(() => vi.restoreAllMocks());

describe('resolveAgentToken', () => {
  it('rejects malformed values without touching the database', async () => {
    const spy = vi.spyOn(admin, 'createAdminClient');
    for (const bad of [undefined, null, 42, '', 'Bearer x', 'spl_pat_short', `spl_pat_${'a'.repeat(44)}`, `xxx_pat_${'a'.repeat(43)}`, `spl_pat_${'a'.repeat(42)}!`]) {
      expect(await resolveAgentToken(bad)).toEqual({ ok: false, reason: 'malformed' });
    }
    expect(spy).not.toHaveBeenCalled();
    // the spy does see real lookups, so the line above means something
    await resolveAgentToken(generateAgentToken().token);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('rejects a well-formed token nobody holds', async () => {
    expect(await resolveAgentToken(generateAgentToken().token)).toEqual({ ok: false, reason: 'unknown' });
  });

  it('returns the actor for a live token', async () => {
    const user = await createUser('actor');
    const t = await insertToken(user, { scopes: ['read', 'bills:write'] });
    expect(await resolveAgentToken(t.token)).toEqual({ ok: true, actor: { userId: user.id, tokenId: t.id, scopes: ['read', 'bills:write'] } });
  });

  it('refuses revoked, suspended and expired tokens, with the expiry boundary exact', async () => {
    const user = await createUser('refused');
    const revoked = await insertToken(user, { revokedAt: new Date() });
    const suspended = await insertToken(user, { suspendedAt: new Date() });
    const expired = await insertToken(user, { expiresAt: new Date(Date.now() - 1) });
    const lastSecond = await insertToken(user, { expiresAt: new Date(Date.now() + 5000) });
    expect(await resolveAgentToken(revoked.token)).toEqual({ ok: false, reason: 'revoked' });
    expect(await resolveAgentToken(suspended.token)).toEqual({ ok: false, reason: 'suspended' });
    expect(await resolveAgentToken(expired.token)).toEqual({ ok: false, reason: 'expired' });
    expect((await resolveAgentToken(lastSecond.token)).ok).toBe(true);
  });

  it('stops working on the very next call after a revoke', async () => {
    const user = await createUser('nextcall');
    const t = await insertToken(user);
    expect((await resolveAgentToken(t.token)).ok).toBe(true);
    await db().from('agent_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', t.id);
    expect(await resolveAgentToken(t.token)).toEqual({ ok: false, reason: 'revoked' });
  });

  it('finds a token by its hash, which is what the database holds', async () => {
    const user = await createUser('hashes');
    const t = await insertToken(user);
    const { data } = await db().from('agent_tokens').select('token_hash').eq('id', t.id).single();
    expect(data!.token_hash).toBe(hashAgentToken(t.token));
    expect(JSON.stringify(data)).not.toContain(t.token);
  });
});

describe('token format and storage', () => {
  it('generates distinct 256-bit tokens with the prefix and a hash that is deterministic', () => {
    const tokens = Array.from({ length: 50 }, () => generateAgentToken());
    expect(new Set(tokens.map((t) => t.token)).size).toBe(50);
    for (const t of tokens) {
      expect(t.token).toMatch(/^spl_pat_[A-Za-z0-9_-]{43}$/);
      expect(t.hash).toBe(hashAgentToken(t.token));
      expect(t.last4).toBe(t.token.slice(-4));
    }
  });

  it('refuses the same hash twice (unique index)', async () => {
    const user = await createUser('dupe');
    const t = await insertToken(user);
    const { error } = await db().from('agent_tokens').insert({
      user_id: user.id, name: 'again', token_hash: t.hash, last4: 'abcd', scopes: ['read'],
      expires_at: new Date(Date.now() + 1000).toISOString(),
    });
    expect(error?.code).toBe('23505');
  });

  it('refuses unknown scopes and empty scopes at the database', async () => {
    const user = await createUser('scopes');
    for (const scopes of [[], ['admin'], ['read', 'admin']]) {
      const { error } = await db().from('agent_tokens').insert({
        user_id: user.id, name: 'x', token_hash: generateAgentToken().hash, last4: 'abcd', scopes,
        expires_at: new Date(Date.now() + 1000).toISOString(),
      });
      expect(error).not.toBeNull();
    }
  });
});

describe('hitRateLimit', () => {
  it('counts hits and denies past the limit', async () => {
    const key = `unit:${Math.random()}`;
    const results = [];
    for (let i = 0; i < 3; i++) results.push((await hitRateLimit(key, 2, 60)).allowed);
    expect(results).toEqual([true, true, false]);
  });

  it('denies when the database call errors or throws', async () => {
    const real = admin.createAdminClient();
    const rpc = vi.spyOn(real, 'rpc');
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'down' } } as never);
    expect((await hitRateLimit('k', 5, 60)).allowed).toBe(false);
    rpc.mockRejectedValueOnce(new Error('network'));
    expect((await hitRateLimit('k', 5, 60)).allowed).toBe(false);
  });
});

describe('touchAgentToken', () => {
  it('writes at most once a minute', async () => {
    const user = await createUser('touch');
    const t = await insertToken(user);
    await touchAgentToken(t.id, '1.1.1.1');
    const first = (await db().from('agent_tokens').select('last_used_at, last_used_ip').eq('id', t.id).single()).data!;
    expect(first.last_used_ip).toBe('1.1.1.1');
    await touchAgentToken(t.id, '2.2.2.2');
    const second = (await db().from('agent_tokens').select('last_used_at, last_used_ip').eq('id', t.id).single()).data!;
    expect(second).toEqual(first);

    await db().from('agent_tokens').update({ last_used_at: new Date(Date.now() - 120_000).toISOString() }).eq('id', t.id);
    await touchAgentToken(t.id, '3.3.3.3');
    expect((await db().from('agent_tokens').select('last_used_ip').eq('id', t.id).single()).data!.last_used_ip).toBe('3.3.3.3');
  });
});

describe('request helpers', () => {
  const req = (headers: Record<string, string>) => new Request('https://www.splittr.cash/api/agent-tokens', { method: 'POST', headers });

  it('accepts only a same-site Origin', () => {
    expect(isSameSiteOrigin(req({ origin: 'https://www.splittr.cash' }))).toBe(true);
    expect(isSameSiteOrigin(req({ origin: 'https://splittr.cash' }))).toBe(true);
    expect(isSameSiteOrigin(req({ origin: 'https://evil.example' }))).toBe(false);
    expect(isSameSiteOrigin(req({ origin: 'https://www.splittr.cash.evil.example' }))).toBe(false);
    expect(isSameSiteOrigin(req({ origin: 'null' }))).toBe(false);
    expect(isSameSiteOrigin(req({}))).toBe(false);
  });

  it('takes the address from x-real-ip, not from the forwarded chain', () => {
    expect(requestIp(req({ 'x-real-ip': '9.9.9.9', 'x-forwarded-for': '6.6.6.6' }))).toBe('9.9.9.9');
    expect(requestIp(req({ 'x-forwarded-for': '6.6.6.6' }))).toBe('unknown');
  });
});
