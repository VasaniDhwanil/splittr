import { describe, expect, it } from 'vitest';
import { generateAgentToken } from '@/lib/agent-tokens';
import { activeTokens, callMint, insertToken, seedPending } from './helpers/agent';
import { createUser, db, sql } from './helpers/db';

// mint_agent_token and agent_rate_limit are the security-critical SQL. These
// tests call them directly, with no route in between.

const pendingRow = async (userId: string) => {
  const { data } = await db().from('agent_token_pending').select('*').eq('user_id', userId).maybeSingle();
  return data;
};

describe('mint_agent_token', () => {
  it('mints once with the right code, stores only hashes, and consumes the pending row', async () => {
    const user = await createUser('mint');
    await seedPending(user, { code: '123456', name: 'Claude', scopes: ['read', 'bills:write'], days: 7 });
    const { result, minted } = await callMint(user, '123456');
    expect(result.status).toBe('ok');

    const { data: rows } = await db().from('agent_tokens').select('*').eq('user_id', user.id);
    expect(rows).toHaveLength(1);
    expect(rows![0]).toMatchObject({ name: 'Claude', scopes: ['read', 'bills:write'], token_hash: minted.hash, last4: minted.last4 });
    // frozen at request time: 7 days, not whatever a verify might ask for
    const days = (new Date(rows![0].expires_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThan(7.01);
    expect(JSON.stringify(rows)).not.toContain(minted.token);
    expect((await pendingRow(user.id))?.consumed_at).not.toBeNull();

    // the same code cannot mint a second token
    expect((await callMint(user, '123456')).result.status).toBe('no_pending');
  });

  it('counts a wrong code, reports attempts left, and refuses the sixth attempt', async () => {
    const user = await createUser('wrong');
    await seedPending(user, { code: '123456' });
    const left: (number | undefined)[] = [];
    for (let i = 0; i < 5; i++) {
      const { result } = await callMint(user, '000000');
      expect(result.status).toBe('wrong_code');
      left.push(result.attempts_left);
    }
    expect(left).toEqual([4, 3, 2, 1, 0]);
    expect((await pendingRow(user.id))?.attempts).toBe(5);
    // even the right code is refused now
    expect((await callMint(user, '123456')).result.status).toBe('too_many_attempts');
    expect(await activeTokens(user)).toHaveLength(0);
  });

  it('refuses an expired pending request and a missing one', async () => {
    const user = await createUser('expired');
    expect((await callMint(user, '123456')).result.status).toBe('no_pending');
    await seedPending(user, { code: '123456', expiresAt: new Date(Date.now() - 1000) });
    expect((await callMint(user, '123456')).result.status).toBe('expired');
  });

  it('binds a code to the account it was issued to', async () => {
    const a = await createUser('bind-a');
    const b = await createUser('bind-b');
    await seedPending(a, { code: '111111' });
    await seedPending(b, { code: '222222' });
    // A's code against B's pending row, and B's code against A's
    expect((await callMint(b, '111111')).result.status).toBe('wrong_code');
    expect((await callMint(a, '222222')).result.status).toBe('wrong_code');
    expect((await callMint(a, '111111')).result.status).toBe('ok');
  });

  it('locks minting for a day after ten wrong codes, even for the right code', async () => {
    const user = await createUser('lock');
    for (let round = 0; round < 2; round++) {
      await seedPending(user, { code: '123456' });
      for (let i = 0; i < 5; i++) await callMint(user, '000000');
    }
    const { data: state } = await db().from('agent_mint_state').select('*').eq('user_id', user.id).single();
    expect(state!.failed_verifies).toBe(10);
    expect(state!.locked_until).not.toBeNull();

    await seedPending(user, { code: '123456' });
    const { result } = await callMint(user, '123456');
    expect(result.status).toBe('locked');
    expect(await activeTokens(user)).toHaveLength(0);

    // deleting the row (what a fresh sign-in does) unlocks
    await db().from('agent_mint_state').delete().eq('user_id', user.id);
    expect((await callMint(user, '123456')).result.status).toBe('ok');
  });

  it('starts a new failure window after 24 hours', async () => {
    const user = await createUser('window');
    await db().from('agent_mint_state').insert({
      user_id: user.id,
      failed_verifies: 9,
      window_started_at: new Date(Date.now() - 25 * 3600_000).toISOString(),
    });
    await seedPending(user, { code: '123456' });
    await callMint(user, '000000');
    const { data } = await db().from('agent_mint_state').select('*').eq('user_id', user.id).single();
    expect(data!.failed_verifies).toBe(1);
    expect(data!.locked_until).toBeNull();
  });

  it('refuses a sixth active token, but expired and revoked ones do not count', async () => {
    const user = await createUser('cap');
    await insertToken(user, { expiresAt: new Date(Date.now() - 1000) });
    await insertToken(user, { revokedAt: new Date() });
    for (let i = 0; i < 5; i++) {
      await seedPending(user, { code: '123456' });
      expect((await callMint(user, '123456')).result.status).toBe('ok');
    }
    await seedPending(user, { code: '123456' });
    expect((await callMint(user, '123456')).result.status).toBe('token_limit');
    // five live ones plus the expired row, which is unrevoked but not active
    expect(await activeTokens(user)).toHaveLength(6);
  });
});

describe('mint_agent_token races', () => {
  it('ten parallel correct verifies make exactly one token', async () => {
    const user = await createUser('race-ok');
    await seedPending(user, { code: '123456' });
    const results = await Promise.all(Array.from({ length: 10 }, () => callMint(user, '123456')));
    const statuses = results.map((r) => r.result.status);
    expect(statuses.filter((s) => s === 'ok')).toHaveLength(1);
    expect(statuses.filter((s) => s === 'no_pending')).toHaveLength(9);
    expect(await activeTokens(user)).toHaveLength(1);
  });

  it('ten parallel wrong verifies stop at five attempts', async () => {
    const user = await createUser('race-wrong');
    await seedPending(user, { code: '123456' });
    const results = await Promise.all(Array.from({ length: 10 }, () => callMint(user, '000000')));
    const statuses = results.map((r) => r.result.status);
    expect(statuses.filter((s) => s === 'wrong_code')).toHaveLength(5);
    expect(statuses.filter((s) => s === 'too_many_attempts')).toHaveLength(5);
    expect((await pendingRow(user.id))?.attempts).toBe(5);
  });

  it('six parallel mints with four active tokens make one more, never a sixth', async () => {
    const user = await createUser('race-cap');
    for (let i = 0; i < 4; i++) await insertToken(user);
    await seedPending(user, { code: '123456' });
    const results = await Promise.all(Array.from({ length: 6 }, () => callMint(user, '123456')));
    expect(results.filter((r) => r.result.status === 'ok')).toHaveLength(1);
    expect(await activeTokens(user)).toHaveLength(5);
  });

  it('parallel requests for different accounts do not block or cross', async () => {
    const users = await Promise.all([createUser('par-a'), createUser('par-b'), createUser('par-c')]);
    await Promise.all(users.map((u, i) => seedPending(u, { code: `00000${i}` })));
    const results = await Promise.all(users.map((u, i) => callMint(u, `00000${i}`)));
    expect(results.map((r) => r.result.status)).toEqual(['ok', 'ok', 'ok']);
  });
});

describe('agent_rate_limit', () => {
  it('allows up to the limit inside a window, then denies with a retry time', async () => {
    const key = `test:${generateAgentToken().last4}:${Date.now()}`;
    const calls = [] as { allowed: boolean; count: number; retry_after: number }[];
    for (let i = 0; i < 4; i++) {
      const { data, error } = await db().rpc('agent_rate_limit', { p_key: key, p_limit: 3, p_window_seconds: 3600 });
      expect(error).toBeNull();
      calls.push(data);
    }
    expect(calls.map((c) => c.allowed)).toEqual([true, true, true, false]);
    expect(calls[3].count).toBe(4);
    expect(calls[3].retry_after).toBeGreaterThanOrEqual(1);
    expect(calls[3].retry_after).toBeLessThanOrEqual(3600);
  });

  it('counts parallel hits exactly', async () => {
    const key = `test-par:${Date.now()}:${Math.random()}`;
    const results = await Promise.all(
      Array.from({ length: 20 }, async () => {
        const { data } = await db().rpc('agent_rate_limit', { p_key: key, p_limit: 5, p_window_seconds: 3600 });
        return data as { allowed: boolean };
      })
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });
});

describe('who can call the functions', () => {
  const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const rpc = (fn: string, body: unknown, key = anon()) =>
    fetch(`${url()}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('the anon key cannot call mint_agent_token, agent_rate_limit or prune_agent_access', async () => {
    const user = await createUser('anon-rpc');
    await seedPending(user, { code: '123456' });
    const mint = await rpc('mint_agent_token', {
      p_user_id: user.id,
      p_code_hmac: 'x',
      p_token_hash: 'y',
      p_last4: 'abcd',
      p_revoke_link_hash: 'z',
    });
    expect([401, 403, 404]).toContain(mint.status);
    expect(await mint.text()).not.toContain('"status"');

    const limit = await rpc('agent_rate_limit', { p_key: 'k', p_limit: 1, p_window_seconds: 60 });
    expect([401, 403, 404]).toContain(limit.status);
    const prune = await rpc('prune_agent_access', {});
    expect([401, 403, 404]).toContain(prune.status);

    // and nothing happened: the pending row is untouched
    expect((await pendingRow(user.id))?.attempts).toBe(0);
  });

  it('a signed-in user key cannot either, and the tables are closed to anon', async () => {
    const user = await createUser('authed-rpc');
    const [row] = await sql<{ rolname: string; fn: string; can: boolean }>(
      `SELECT 'authenticated' AS rolname, 'mint' AS fn,
              has_function_privilege('authenticated', 'public.mint_agent_token(uuid,text,text,text,text)', 'EXECUTE') AS can`
    );
    expect(row.can).toBe(false);
    const res = await fetch(`${url()}/rest/v1/agent_tokens?select=*`, {
      headers: { apikey: anon(), Authorization: `Bearer ${anon()}` },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    void user;
  });
});

describe('deleting the account', () => {
  it('removes its tokens and leaves agent-created bills with no token', async () => {
    const user = await createUser('cascade');
    const token = await insertToken(user);
    const { data: bill } = await db()
      .from('bills')
      .insert({
        name: 'agent bill', subtotal: 1, tax: 0, tip_percent: 0, tip_amount: 0,
        short_code: Math.random().toString(36).slice(2, 8).toUpperCase(), status: 'active',
        agent_token_id: token.id,
      })
      .select('id')
      .single();
    // Plain SQL: deleting through GoTrue fails for any account that has a bill
    // (the doorbell trigger can't run as supabase_auth_admin), which predates this feature.
    await sql('DELETE FROM auth.users WHERE id = $1', [user.id]);
    const { data: gone } = await db().from('agent_tokens').select('id').eq('id', token.id);
    expect(gone).toHaveLength(0);
    const { data: after } = await db().from('bills').select('agent_token_id').eq('id', bill!.id).single();
    expect(after!.agent_token_id).toBeNull();
  });
});
