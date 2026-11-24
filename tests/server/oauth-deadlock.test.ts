import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST as revokeAll } from '@/app/api/agent-tokens/revoke-all/route';
import { POST as revokeLink } from '@/app/api/agent-tokens/revoke-link/route';
import { createUser, db, request } from './helpers/db';
import { runAs, signOut } from './helpers/session';
import { callApprove, callRedeem, connect, enableOAuth, seedRequest, sha } from './helpers/oauth-server';

// F7: revoke-all / the "Not you?" link against a redemption that replaces grants
// of the same account. They used to take grant rows in different orders.

let restore: () => void;
beforeAll(() => {
  restore = enableOAuth();
});
afterAll(() => {
  restore();
  signOut();
});

const ORIGIN = { origin: 'http://localhost:3000' };
const ROUNDS = 30;

async function grantsOf(userId: string) {
  return (await db().from('agent_tokens').select('id, revoked_at, oauth_status, revoked_reason').eq('user_id', userId).eq('kind', 'oauth')).data!;
}

describe('revoke-all racing a redemption that replaces grants', () => {
  it(`never deadlocks and always ends consistent (${ROUNDS} rounds)`, async () => {
    const user = await createUser('deadlock');
    for (let round = 0; round < ROUNDS; round++) {
      // three live grants for the client; the new one replaces all of them
      await connect(user);
      await connect(user);
      await connect(user);
      const req = await seedRequest(user);
      const { result, code } = await callApprove(user, req, { replace: true });
      expect(result.status).toBe('ok');

      const [redeem, revoke] = await Promise.all([
        callRedeem(code).then((r) => ({ ok: true as const, status: r.result.status }), (e: Error) => ({ ok: false as const, error: e.message })),
        runAs(user, () => revokeAll(request('POST', '/api/agent-tokens/revoke-all', { headers: ORIGIN }))),
      ]);
      expect(redeem.ok ? '' : (redeem as { error: string }).error, `round ${round}`).not.toMatch(/deadlock/i);
      expect(redeem.ok, `round ${round}: ${JSON.stringify(redeem)}`).toBe(true);
      // revoke-all first: the code is gone (not_found) or the new grant is revoked (invalid); redemption first: ok
      expect(['ok', 'invalid', 'not_found']).toContain((redeem as { status: string }).status);
      expect(revoke.status, `round ${round}`).toBe(200);

      // Whichever came first, nothing of this account stays live, and no live grant lacks tokens
      const grants = await grantsOf(user.id);
      expect(grants.filter((g) => g.revoked_at === null), `round ${round}`).toEqual([]);
      const tokens = (await db().from('agent_oauth_tokens').select('hash').in('grant_id', grants.map((g) => g.id))).data!;
      expect(tokens).toEqual([]);
    }
  }, 120_000);

  it('the Not-you link races a redemption the same way', async () => {
    const user = await createUser('deadlock-link');
    for (let round = 0; round < 15; round++) {
      await connect(user);
      await connect(user);
      const req = await seedRequest(user);
      const { result, code } = await callApprove(user, req, { replace: true });
      expect(result.status).toBe('ok');
      const secret = randomBytes(32).toString('base64url');
      await db().from('agent_tokens').update({ revoke_link_hash: sha(secret) }).eq('id', result.grant_id!);
      const [redeem, link] = await Promise.all([
        callRedeem(code).then((r) => ({ ok: true as const, status: r.result.status }), (e: Error) => ({ ok: false as const, error: e.message })),
        revokeLink(request('POST', '/api/agent-tokens/revoke-link', { headers: ORIGIN, body: { secret } })),
      ]);
      expect(redeem.ok, `round ${round}: ${JSON.stringify(redeem)}`).toBe(true);
      expect(link.status, `round ${round}`).toBe(200);
      expect((await grantsOf(user.id)).filter((g) => g.revoked_at === null), `round ${round}`).toEqual([]);
    }
  }, 120_000);
});

describe('revoke_account_agent_tokens', () => {
  it('waits for the account\'s advisory lock, like approval and redemption', async () => {
    const user = await createUser('lock-wait');
    const { grantId } = await connect(user);
    const holder = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await holder.connect();
    try {
      await holder.query('begin');
      await holder.query(`select pg_advisory_xact_lock(hashtextextended('agent_mint:' || $1::text, 0))`, [user.id]);
      let finished = false;
      const pending = Promise.resolve(db().rpc('revoke_account_agent_tokens', { p_user_id: user.id, p_reason: 'revoke_all', p_include_expired: false })).then((r) => {
        finished = true;
        return r;
      });
      await new Promise((r) => setTimeout(r, 500));
      expect(finished).toBe(false);
      await holder.query('commit');
      const result = await pending;
      expect(result.data).toEqual([grantId]);
    } finally {
      await holder.end();
    }
  });
});
