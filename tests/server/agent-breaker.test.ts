import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { POST as decline } from '@/app/api/agent-bills/[id]/decline/route';
import { POST as resume } from '@/app/api/agent-tokens/[id]/resume/route';
import { enableAgentAccess, insertToken } from './helpers/agent';
import { createUser, db, params, request, uuid } from './helpers/db';
import { callTool, rpcBody, send } from './helpers/mcp';
import { signInAs, signOut, type TestUser } from './helpers/session';

let restoreEnv: () => void;
beforeAll(() => {
  restoreEnv = enableAgentAccess();
});
afterAll(() => restoreEnv());

let user: TestUser;
let token: string;
let tokenId: string;

beforeEach(async () => {
  signOut();
  mail.sent.length = 0;
  user = await createUser('breaker', 'Brenda');
  const t = await insertToken(user, { name: 'Chatty agent', scopes: ['read', 'bills:write'] });
  token = t.token;
  tokenId = t.id;
});

const OK_ITEMS = [{ name: 'Soup', price: 5, quantity: 1 }];
const overCap = (i: number) => callTool(token, 'create_bill', { name: `Big ${i}`, items: [{ name: 'Yacht', price: 5000, quantity: 1 }] });
const tooMany = (i: number) =>
  callTool(token, 'create_bill', { name: `Many ${i}`, items: Array.from({ length: 41 }, (_, n) => ({ name: `i${n}`, price: 1, quantity: 1 })) });
const unitCap = (i: number) => callTool(token, 'create_bill', { name: `Pricey ${i}`, items: [{ name: 'Gold', price: 1500, quantity: 1 }] });
const propose = async (name: string) => (await callTool(token, 'create_bill', { name, items: OK_ITEMS })).data.bill_id as string;
const duplicate = () => callTool(token, 'create_bill', { name: 'Same', items: OK_ITEMS });

const suspension = async () =>
  (await db().from('agent_tokens').select('suspended_at, suspended_reason').eq('id', tokenId).single()).data!;
const listTools = async () => {
  const res = await send(rpcBody('tools/list'), { token });
  return { status: res.status, json: await res.json() };
};

describe('circuit breaker (G4)', () => {
  const kinds: [string, (i: number) => ReturnType<typeof overCap>][] = [
    ['total_cap', overCap],
    ['too_many_items', tooMany],
    ['unit_price_cap', unitCap],
  ];

  it.each(kinds)('five %s refusals in an hour pause the token; four do not', async (_kind, refuse) => {
    for (let i = 0; i < 4; i++) {
      expect((await refuse(i)).isError).toBe(true);
      expect((await suspension()).suspended_at).toBeNull();
    }
    expect(mail.sent).toHaveLength(0);
    await refuse(4);
    const state = await suspension();
    expect(state.suspended_at).not.toBeNull();
    expect(state.suspended_reason).toMatch(/refused/);
  });

  it('five duplicate refusals pause the token', async () => {
    await duplicate();
    for (let i = 0; i < 4; i++) {
      await duplicate();
      expect((await suspension()).suspended_at).toBeNull();
    }
    await duplicate();
    expect((await suspension()).suspended_at).not.toBeNull();
  });

  it('a mix of the four kinds adds up', async () => {
    await duplicate();
    await overCap(0);
    await tooMany(0);
    await unitCap(0);
    await duplicate();
    expect((await suspension()).suspended_at).toBeNull(); // four
    await overCap(1);
    expect((await suspension()).suspended_at).not.toBeNull();
  });

  it('three declines pause the token; two do not', async () => {
    const ids = [await propose('One'), await propose('Two'), await propose('Three')];
    signInAs(user);
    for (const [n, id] of ids.entries()) {
      const res = await decline(request('POST', `/api/agent-bills/${id}/decline`, { headers: { origin: 'http://localhost:3000' } }), params({ id }));
      expect(res.status).toBe(200);
      expect((await suspension()).suspended_at !== null).toBe(n === 2);
    }
    expect((await suspension()).suspended_reason).toMatch(/declined/);
    expect(mail.sent).toHaveLength(1);
  });

  it('after pausing: the next call is 401 saying paused and why, and exactly one email went out', async () => {
    for (let i = 0; i < 5; i++) await overCap(i);
    const res = await listTools();
    expect(res.status).toBe(401);
    expect(res.json.error.data.reason).toBe('suspended');
    expect(res.json.error.message).toMatch(/paused/);
    expect(res.json.error.message).toMatch(/refused/);
    const again = await callTool(token, 'list_my_bills', {});
    expect(again.status).toBe(401);

    expect(mail.sent).toHaveLength(1);
    const [email] = mail.sent;
    expect(email.to).toBe(user.email);
    expect(email.subject).toMatch(/paused/);
    expect(email.text).toContain('Chatty agent');
    expect(email.text).toContain('https://www.splittr.cash/profile');
    expect(JSON.stringify(email)).not.toMatch(/spl_pat_/);
  });

  it('parallel refusals still send one email', async () => {
    await Promise.all(Array.from({ length: 12 }, (_, i) => overCap(i)));
    expect((await suspension()).suspended_at).not.toBeNull();
    expect(mail.sent).toHaveLength(1);
  });

  it('resuming makes the token work again, with a fresh count', async () => {
    for (let i = 0; i < 5; i++) await overCap(i);
    expect((await listTools()).status).toBe(401);
    signInAs(user);
    const res = await resume(request('POST', `/api/agent-tokens/${tokenId}/resume`, { headers: { origin: 'http://localhost:3000' } }), params({ id: tokenId }));
    expect(res.status).toBe(200);
    expect((await listTools()).status).toBe(200);
    expect((await callTool(token, 'list_my_bills', {})).isError).toBe(false);
    // one more refusal does not pause it again at once
    await overCap(99);
    expect((await suspension()).suspended_at).toBeNull();
    expect((await listTools()).status).toBe(200);
  });

  it('does not count not-found results, invalid input, daily-cap refusals or warnings', async () => {
    for (let i = 0; i < 50; i++) await callTool(token, 'get_bill', { bill_id: uuid() });
    expect((await suspension()).suspended_at).toBeNull();
    // the per-token limit is 60 calls a minute: the rest go through a second token
    const second = await insertToken(user, { name: 'second', scopes: ['read', 'bills:write'] });
    for (let i = 0; i < 8; i++) await callTool(second.token, 'create_bill', { name: '', items: [] });
    for (let i = 0; i < 6; i++) {
      const res = await callTool(second.token, 'create_bill', {
        name: `see https://example.com/${i}`,
        items: [{ name: `me${i}@example.com`, price: 1, quantity: 1 }],
      });
      expect(res.isError).toBe(false);
      expect(res.data.warnings.length).toBeGreaterThan(0);
    }
    const state = (await db().from('agent_tokens').select('suspended_at').eq('id', second.id).single()).data!;
    expect(state.suspended_at).toBeNull();
    expect(mail.sent).toHaveLength(0);
  });

  it('another token of the same account is not affected', async () => {
    const other = await insertToken(user, { scopes: ['read'] });
    for (let i = 0; i < 5; i++) await overCap(i);
    expect((await listTools()).status).toBe(401);
    const res = await send(rpcBody('tools/list'), { token: other.token });
    expect(res.status).toBe(200);
  });

  it('refusals older than an hour do not count', async () => {
    for (let i = 0; i < 4; i++) await overCap(i);
    await db()
      .from('agent_audit_log')
      .update({ created_at: new Date(Date.now() - 61 * 60_000).toISOString() })
      .eq('token_id', tokenId);
    await overCap(10);
    expect((await suspension()).suspended_at).toBeNull();
  });
});
