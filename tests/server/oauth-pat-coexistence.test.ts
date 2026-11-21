import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/email', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/email')>();
  return { ...real, isEmailConfigured: () => true, sendEmail: async () => ({ ok: true, id: 'test' }) };
});

import { POST as requestCode } from '@/app/api/agent-tokens/route';
import { findProposal } from '@/lib/agent-bills';
import { enableAgentAccess, insertProposal, insertToken } from './helpers/agent';
import { createUser, request } from './helpers/db';
import { connect, HOSTED_CLIENT_ID, callApprove, callRedeem, seedRequest } from './helpers/oauth';
import { db } from './helpers/db';
import { signInAs, signOut } from './helpers/session';

let restore: () => void;
beforeAll(() => {
  restore = enableAgentAccess();
});
afterAll(() => {
  restore();
  signOut();
});

const ask = () =>
  requestCode(
    request('POST', '/api/agent-tokens', {
      body: { name: 'Mine', scopes: ['read'], expires_in_days: 30 },
      headers: { origin: 'http://localhost:3000' },
    }) as never
  );

describe('personal tokens and OAuth grants count separately (A8)', () => {
  it('five OAuth grants do not use up the personal-token cap', async () => {
    const user = await createUser('coexist');
    for (let i = 0; i < 5; i++) await connect(user);
    signInAs(user);
    expect((await ask()).status).toBe(200);
  });

  it('five personal tokens still stop a sixth, with OAuth grants alongside', async () => {
    const user = await createUser('coexist2');
    await connect(user);
    for (let i = 0; i < 5; i++) await insertToken(user);
    signInAs(user);
    const res = await ask();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('token_limit');
  });
});

describe('proposals of a replaced connection (A7)', () => {
  it('stay reachable when replaced, and vanish when the connection is revoked', async () => {
    const user = await createUser('proposals');
    const old = await connect(user, { clientId: HOSTED_CLIENT_ID });
    const proposal = await insertProposal(user, old.grantId);
    const { code } = await callApprove(user, await seedRequest(user, { clientId: HOSTED_CLIENT_ID }), {
      replace: true,
      destination: 'claude.ai',
    });
    await callRedeem(code);
    expect(await findProposal(user.id, proposal)).not.toBeNull();

    const other = await connect(user, { clientId: HOSTED_CLIENT_ID });
    const second = await insertProposal(user, other.grantId);
    await db().from('agent_tokens').update({ revoked_at: new Date().toISOString(), revoked_reason: 'user' }).eq('id', other.grantId);
    expect(await findProposal(user.id, second)).toBeNull();
  });
});
