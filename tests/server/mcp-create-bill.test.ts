import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as billsPost } from '@/app/api/bills/route';
import { enableAgentAccess, insertToken } from './helpers/agent';
import { createBill, createUser, db, request } from './helpers/db';
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
  user = await createUser('writer', 'Wendy Writer');
  const t = await insertToken(user, { scopes: ['read', 'bills:write'] });
  token = t.token;
  tokenId = t.id;
});

const ITEMS = [
  { name: 'Pasta', price: 18.5, quantity: 1 },
  { name: 'Beer', price: 7, quantity: 2 },
];
const create = (args: Record<string, unknown> = {}, t = token) =>
  callTool(t, 'create_bill', { name: 'Team dinner', items: ITEMS, ...args });

const billsOf = async (u = user) => (await db().from('bills').select('*').eq('creator_user_id', u.id)).data!;
const audits = async (id = tokenId) =>
  (await db().from('agent_audit_log').select('tool, outcome').eq('token_id', id).eq('tool', 'create_bill').order('id')).data!.map((r) => r.outcome);

describe('tools/list', () => {
  it('shows create_bill to a bills:write token only, with honest annotations and description', async () => {
    const names = async (t: string) =>
      ((await (await send(rpcBody('tools/list'), { token: t })).json()).result.tools as { name: string }[]).map((x) => x.name);
    const readOnly = await insertToken(user, { scopes: ['read'] });
    expect(await names(readOnly.token)).not.toContain('create_bill');
    expect(await names(token)).toContain('create_bill');

    const { result } = await (await send(rpcBody('tools/list'), { token })).json();
    const tool = result.tools.find((x: { name: string }) => x.name === 'create_bill');
    expect(tool.annotations.openWorldHint).toBe(true);
    expect(tool.annotations.readOnlyHint).toBeUndefined();
    expect(tool.annotations.destructiveHint).not.toBe(false);
    expect(tool.description).toMatch(/does not exist for anyone/i);
    expect(tool.description).toMatch(/approval_url/);
    expect(tool.inputSchema.additionalProperties).toBe(false);
  });

  it('a read-only token calling create_bill gets the same error as for an unknown tool', async () => {
    const readOnly = await insertToken(user, { scopes: ['read'] });
    const refused = await callTool(readOnly.token, 'create_bill', { name: 'x', items: ITEMS });
    const unknown = await callTool(readOnly.token, 'no_such_tool', {});
    expect(refused.error).toEqual(unknown.error);
    expect(await billsOf()).toHaveLength(0);
  });
});

describe('a proposed bill', () => {
  it('is stored awaiting approval, with its items and a host row named from the profile', async () => {
    const before = Date.now();
    const res = await create({ tax: 3.2, tip_percent: 20 });
    expect(res.isError).toBe(false);
    const { bill_id, status, approval_url, share_url, expires_at, warnings } = res.data;
    expect(status).toBe('awaiting_approval');
    expect(approval_url).toBe(`https://www.splittr.cash/approve/${bill_id}`);
    expect(share_url).toBe(`https://www.splittr.cash/bill/${bill_id}`);
    expect(warnings).toEqual([]);
    const expiry = Date.parse(expires_at);
    expect(expiry).toBeGreaterThan(before + 24 * 3600_000 - 5000);
    expect(expiry).toBeLessThan(Date.now() + 24 * 3600_000 + 5000);

    const [bill] = await billsOf();
    expect(bill).toMatchObject({
      id: bill_id,
      name: 'Team dinner',
      status: 'active',
      approval_required: true,
      approved_at: null,
      created_via: 'agent',
      agent_token_id: tokenId,
      creator_user_id: user.id,
      creator_token: null,
      group_id: null,
      paid_by_user_id: null,
      split_mode: 'items',
      tip_split: 'proportional',
    });
    expect(bill.short_code).toMatch(/^[A-Z0-9]{6}$/);
    expect(Date.parse(bill.approval_expires_at)).toBe(expiry);

    const items = (await db().from('bill_items').select('name, price, quantity').eq('bill_id', bill_id).order('created_at')).data!;
    expect(items).toEqual(ITEMS.map((i) => ({ ...i })));
    const people = (await db().from('participants').select('name, is_creator, user_id').eq('bill_id', bill_id)).data!;
    expect(people).toEqual([{ name: 'Wendy Writer', is_creator: true, user_id: user.id }]);
  });

  it('names the host "Host" when the profile has no display name', async () => {
    await db().from('profiles').update({ display_name: '' }).eq('user_id', user.id);
    const res = await create();
    const people = (await db().from('participants').select('name').eq('bill_id', res.data.bill_id)).data!;
    expect(people).toEqual([{ name: 'Host' }]);
  });

  it('never returns a creator token or secrets', async () => {
    const res = await create();
    expect(res.text).not.toMatch(/creator_token|short_code|participant_token|spl_pat_/);
    expect(Object.keys(res.data).sort()).toEqual(['approval_url', 'bill_id', 'expires_at', 'share_url', 'status', 'warnings']);
  });

  it('links never come from request headers', async () => {
    const res = await send(rpcBody('tools/call', { name: 'create_bill', arguments: { name: 'Hdr', items: ITEMS } }), {
      token,
      headers: { host: 'evil.example', 'x-forwarded-host': 'evil.example', origin: 'https://evil.example' },
    });
    // a foreign Origin is refused outright; a forged Host or forwarded host is simply ignored
    expect(res.status).toBe(403);
    const ok = await send(rpcBody('tools/call', { name: 'create_bill', arguments: { name: 'Hdr', items: ITEMS } }), {
      token,
      headers: { host: 'evil.example', 'x-forwarded-host': 'evil.example' },
      url: 'http://evil.example/api/mcp',
    });
    const text = await ok.text();
    expect(text).toContain('https://www.splittr.cash/approve/');
    expect(text).not.toContain('evil.example');
  });

  it('uses NEXT_PUBLIC_SITE_URL when it is set', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3199/';
    try {
      const res = await create();
      expect(res.data.approval_url).toBe(`http://localhost:3199/approve/${res.data.bill_id}`);
    } finally {
      delete process.env.NEXT_PUBLIC_SITE_URL;
    }
  });

  it('is indistinguishable from a web-created bill: same subtotal and tip, by percent and by amount', async () => {
    for (const tip of [{ tip_percent: 18 }, { tip_amount: 6.75 }, {}]) {
      signInAs(user);
      const web = await billsPost(
        request('POST', '/api/bills', { body: { name: 'W', creator_name: 'Me', items: ITEMS, tax: 2.25, ...tip } })
      );
      const { id: webId } = await web.json();
      const agent = await create({ name: `A ${JSON.stringify(tip)}`, tax: 2.25, ...tip });
      const pick = async (id: string) =>
        (await db().from('bills').select('subtotal, tax, tip_percent, tip_amount').eq('id', id).single()).data;
      expect(await pick(agent.data.bill_id)).toEqual(await pick(webId));
    }
  });

  it('cleans text the way the web does: control characters out, whitespace collapsed', async () => {
    const res = await create({ name: '  Dinner\u0000\n  at   Joe\u0007s  ', items: [{ name: 'Fish\tand  chips', price: 9, quantity: 1 }] });
    const [bill] = await billsOf();
    expect(bill.name).toBe('Dinner at Joe s');
    const [item] = (await db().from('bill_items').select('name').eq('bill_id', res.data.bill_id)).data!;
    expect(item.name).toBe('Fish and chips');
  });

  it('split_mode and tip_split are honoured', async () => {
    await create({ split_mode: 'even', tip_split: 'even' });
    expect(await billsOf()).toMatchObject([{ split_mode: 'even', tip_split: 'even' }]);
  });
});

describe('input is strict (T-INPUT)', () => {
  const bad: [string, Record<string, unknown>][] = [
    ['group_id', { group_id: '3f1c2a52-6f67-4f0e-9d7f-0d9c8f6f9a11' }],
    ['paid_by_user_id', { paid_by_user_id: '3f1c2a52-6f67-4f0e-9d7f-0d9c8f6f9a11' }],
    ['payment handles', { venmo_handle: 'me', zelle_handle: 'me@example.com' }],
    ['participants', { participants: [{ name: 'Zed' }] }],
    ['creator_name', { creator_name: 'Someone Else' }],
    ['status', { status: 'active' }],
    ['both tip_amount and tip_percent', { tip_amount: 5, tip_percent: 10 }],
    ['a negative tax', { tax: -1 }],
    ['a tip percent over 100', { tip_percent: 101 }],
    ['an unknown split_mode', { split_mode: 'custom' }],
    ['an unknown tip_split', { tip_split: 'weird' }],
    ['no items', { items: [] }],
    ['an empty name', { name: '' }],
    ['a 101 character name', { name: 'x'.repeat(101) }],
    ['a 81 character item name', { items: [{ name: 'x'.repeat(81), price: 1, quantity: 1 }] }],
    ['a fractional quantity', { items: [{ name: 'a', price: 1, quantity: 1.5 }] }],
    ['quantity 0', { items: [{ name: 'a', price: 1, quantity: 0 }] }],
    ['quantity 100', { items: [{ name: 'a', price: 1, quantity: 100 }] }],
    ['a negative price', { items: [{ name: 'a', price: -1, quantity: 1 }] }],
    ['a string price', { items: [{ name: 'a', price: '5', quantity: 1 }] }],
    ['an unknown item key', { items: [{ name: 'a', price: 1, quantity: 1, id: 'x' }] }],
    ['a non-string name', { name: 42 }],
  ];
  it.each(bad)('rejects %s and writes no bill', async (_label, extra) => {
    const res = await create(extra);
    expect(res.isError).toBe(true);
    expect(res.message).toMatch(/^Invalid input/);
    expect(await billsOf()).toHaveLength(0);
    expect(await audits()).toEqual(['invalid_input']);
  });

  it('rejects a missing name or items', async () => {
    expect((await callTool(token, 'create_bill', { items: ITEMS })).isError).toBe(true);
    expect((await callTool(token, 'create_bill', { name: 'x' })).isError).toBe(true);
    expect((await callTool(token, 'create_bill', {})).isError).toBe(true);
    expect(await billsOf()).toHaveLength(0);
  });

  it('accepts the boundary values', async () => {
    const res = await create({
      name: 'x'.repeat(100),
      items: [{ name: 'y'.repeat(80), price: 0, quantity: 99 }],
      tax: 0,
      tip_percent: 100,
    });
    expect(res.isError).toBe(false);
  });
});

describe('input policy (G1)', () => {
  const cases: [string, Record<string, unknown>, string, RegExp][] = [
    ['too many items', { items: Array.from({ length: 41 }, (_, i) => ({ name: `i${i}`, price: 1, quantity: 1 })) }, 'too_many_items', /at most 40 items/],
    ['one unit price over the 1000 dollar cap', { items: [{ name: 'Gold', price: 1000.01, quantity: 1 }] }, 'unit_price_cap', /over \$1,000/],
    ['a total over the 2000 dollar cap', { items: [{ name: 'A', price: 900, quantity: 2 }, { name: 'B', price: 300, quantity: 1 }] }, 'total_cap', /over \$2,000/],
    ['a total pushed over the cap by tax and tip', { items: [{ name: 'A', price: 1000, quantity: 1 }], tax: 500, tip_amount: 501 }, 'total_cap', /over \$2,000/],
  ];
  it.each(cases)('refuses %s with a reason, no bill and an audit row', async (_label, args, code, reason) => {
    const res = await create(args);
    expect(res.isError).toBe(true);
    expect(res.message).toMatch(reason);
    expect(await billsOf()).toHaveLength(0);
    expect(await audits()).toEqual([`refused:${code}`]);
  });

  it('accepts exactly $2,000', async () => {
    expect((await create({ items: [{ name: 'A', price: 1000, quantity: 2 }] })).isError).toBe(false);
  });

  it('refuses an identical bill from the same token inside ten minutes, while the first still exists', async () => {
    const first = await create();
    expect(first.isError).toBe(false);
    const again = await create();
    expect(again.isError).toBe(true);
    expect(again.message).toMatch(/identical|already/i);
    expect(await audits()).toEqual(['ok', 'refused:duplicate']);
    expect(await billsOf()).toHaveLength(1);
  });

  it('is not a duplicate when the name, an item or the total differs', async () => {
    expect((await create()).isError).toBe(false);
    expect((await create({ name: 'Team dinner 2' })).isError).toBe(false);
    expect((await create({ items: [{ ...ITEMS[0], quantity: 2 }, ITEMS[1]] })).isError).toBe(false);
    expect((await create({ tax: 1 })).isError).toBe(false);
    expect(await billsOf()).toHaveLength(4);
  });

  it('is not a duplicate of another token\'s bill', async () => {
    const other = await insertToken(user, { scopes: ['read', 'bills:write'] });
    expect((await create()).isError).toBe(false);
    expect((await create({}, other.token)).isError).toBe(false);
  });

  it('is not a duplicate once the first was removed, or is older than ten minutes', async () => {
    const first = await create();
    await db().from('bills').delete().eq('id', first.data.bill_id);
    const second = await create();
    expect(second.isError).toBe(false);
    await db().from('bills').update({ created_at: new Date(Date.now() - 11 * 60_000).toISOString() }).eq('id', second.data.bill_id);
    expect((await create()).isError).toBe(false);
  });

  it('item order does not hide a duplicate', async () => {
    await create();
    const reordered = await create({ items: [...ITEMS].reverse() });
    expect(reordered.isError).toBe(true);
  });
});

describe('daily cap', () => {
  const distinct = (i: number) => ({ name: `Bill ${i}`, items: [{ name: `Thing ${i}`, price: 5 + i, quantity: 1 }] });

  it('holds at 20 bills per account under 30 parallel calls', async () => {
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => create(distinct(i))));
    expect(results.filter((r) => !r.isError)).toHaveLength(20);
    const refused = results.filter((r) => r.isError);
    expect(refused).toHaveLength(10);
    expect(refused.every((r) => /20 bills/.test(r.message!))).toBe(true);
    expect(await billsOf()).toHaveLength(20);
    const log = await audits();
    expect(log.filter((o) => o === 'ok')).toHaveLength(20);
    expect(log.filter((o) => o === 'refused:daily_cap')).toHaveLength(10);
  });

  it('is per account, across its tokens', async () => {
    const second = await insertToken(user, { scopes: ['read', 'bills:write'] });
    await Promise.all(Array.from({ length: 20 }, (_, i) => create(distinct(i))));
    const res = await create(distinct(99), second.token);
    expect(res.isError).toBe(true);
    expect(await audits(second.id)).toEqual(['refused:daily_cap']);
  });

  it('is not spent by invalid or refused calls', async () => {
    // Four counted refusals in all (three here, one duplicate below): one short of pausing the token
    for (let i = 0; i < 3; i++) {
      await create({ items: [{ name: 'x', price: 5000, quantity: 1 }], name: `big ${i}` });
      await create({ name: '' });
    }
    await create(distinct(0));
    await create(distinct(0)); // duplicate
    const results = await Promise.all(Array.from({ length: 19 }, (_, i) => create(distinct(i + 1))));
    expect(results.map((r) => r.error?.message ?? (r.isError ? r.message : 'ok'))).toEqual(Array(19).fill('ok'));
    expect(await billsOf()).toHaveLength(20);
  });

  it('a cap refusal does not count toward the circuit breaker', async () => {
    await Promise.all(Array.from({ length: 30 }, (_, i) => create(distinct(i))));
    const row = (await db().from('agent_tokens').select('suspended_at').eq('id', tokenId).single()).data!;
    expect(row.suspended_at).toBeNull();
  });
});

describe('names that look like secrets (T-GUARD)', () => {
  it('are accepted and flagged, never refused', async () => {
    const res = await create({
      name: 'See https://evil.example/x?k=1',
      items: [
        { name: 'mail me bob@example.com', price: 3, quantity: 1 },
        { name: 'spl_pat_abcdefghijklmnopqrstuvwxyz0123456789', price: 4, quantity: 1 },
        { name: 'Soup', price: 5, quantity: 1 },
      ],
    });
    expect(res.isError).toBe(false);
    expect(res.data.warnings).toHaveLength(3);
    expect(res.data.warnings.join(' ')).toMatch(/web address/);
    expect(res.data.warnings.join(' ')).toMatch(/email address/);
    expect(res.data.warnings.join(' ')).toMatch(/access key/);
    expect(await audits()).toEqual(['ok']);
  });

  it('a realistic receipt passes with no warnings', async () => {
    const res = await create({
      name: 'Lunch at Café Crème',
      items: [
        { name: 'Café Crème', price: 4.5, quantity: 2 },
        { name: '#12 Burrito', price: 11, quantity: 1 },
        { name: '4006381333931', price: 2.99, quantity: 1 },
        { name: 'Desk-side salad', price: 9, quantity: 1 },
      ],
      tax: 2.1,
    });
    expect(res.isError).toBe(false);
    expect(res.data.warnings).toEqual([]);
  });
});

describe('what a proposal is allowed to do', () => {
  it('is invisible to every read tool until approved, even to its creator, then appears in all of them', async () => {
    const res = await create({ name: 'Hidden dinner' });
    const id = res.data.bill_id;
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const [yesterday, tomorrow] = [day(-1), day(1)];
    const reads = async () => ({
      list: (await callTool(token, 'list_my_bills', {})).data.bills.map((b: { id: string }) => b.id),
      get: await callTool(token, 'get_bill', { bill_id: id }),
      expenses: (await callTool(token, 'list_my_expenses', { from: yesterday, to: tomorrow })).data.expenses.map(
        (e: { bill_id: string }) => e.bill_id
      ),
      balances: await callTool(token, 'get_balances', {}),
    });
    const hidden = await reads();
    expect(hidden.list).not.toContain(id);
    expect(hidden.get.isError).toBe(true);
    expect(hidden.get.message).toBe('Bill not found');
    expect(hidden.expenses).not.toContain(id);
    expect(hidden.balances.text).not.toContain(id);

    await db().from('bills').update({ approved_at: new Date().toISOString() }).eq('id', id);
    const live = await reads();
    expect(live.list).toContain(id);
    expect(live.get.isError).toBe(false);
    expect(live.expenses).toContain(id);
  });

  it('is removed by prune_agent_access when it expired, and only then', async () => {
    const expired = (await create({ name: 'Expired' })).data.bill_id;
    const waiting = (await create({ name: 'Waiting' })).data.bill_id;
    const approved = (await create({ name: 'Approved' })).data.bill_id;
    await db().from('bills').update({ approval_expires_at: new Date(Date.now() - 1000).toISOString() }).eq('id', expired);
    await db().from('bills').update({ approved_at: new Date().toISOString(), approval_expires_at: new Date(Date.now() - 1000).toISOString() }).eq('id', approved);
    const { error } = await db().rpc('prune_agent_access');
    expect(error).toBeNull();
    const left = (await db().from('bills').select('id').in('id', [expired, waiting, approved])).data!.map((r) => r.id);
    expect(left.sort()).toEqual([waiting, approved].sort());
    // its items and host row went with it
    expect((await db().from('bill_items').select('id').eq('bill_id', expired)).data).toHaveLength(0);
    expect((await db().from('participants').select('id').eq('bill_id', expired)).data).toHaveLength(0);
  });

  it('an approved agent bill outlives the token\'s user, with agent_token_id cleared', async () => {
    const id = (await create({ name: 'Survivor' })).data.bill_id;
    await db().from('bills').update({ approved_at: new Date().toISOString() }).eq('id', id);
    expect((await db().auth.admin.deleteUser(user.id)).error).toBeNull();
    const bill = (await db().from('bills').select('id, agent_token_id, created_via, approved_at').eq('id', id).single()).data!;
    expect(bill).toMatchObject({ id, agent_token_id: null, created_via: 'agent' });
    expect(bill.approved_at).not.toBeNull();
    expect((await db().from('agent_tokens').select('id').eq('id', tokenId)).data).toHaveLength(0);
  });

  it('a pre-existing web bill is untouched by all of this', async () => {
    const web = await createBill({ creator: user, name: 'Plain web bill' });
    const [row] = (await db().from('bills').select('approval_required, approved_at, created_via, agent_token_id').eq('id', web.id)).data!;
    expect(row).toEqual({ approval_required: false, approved_at: null, created_via: 'web', agent_token_id: null });
  });
});
