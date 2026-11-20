import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enableAgentAccess, insertToken } from './helpers/agent';
import { createBill, createGroup, createUser, db, joinBill } from './helpers/db';
import { callTool } from './helpers/mcp';
import type { TestUser } from './helpers/session';

let restoreEnv: () => void;
beforeAll(() => {
  restoreEnv = enableAgentAccess();
});
afterAll(() => restoreEnv());

const setProfile = (user: TestUser, fields: Record<string, string | null>) =>
  db().from('profiles').update(fields).eq('user_id', user.id);

interface Scenario {
  alice: TestUser;
  bob: TestUser;
  carol: TestUser;
  dan: TestUser;
  token: string;
  groupId: string;
  bills: Record<string, string>;
}

/** One bill, split evenly, so every number below is easy to check by hand. */
const evenBill = (
  creator: TestUser,
  name: string,
  total: number,
  opts: { groupId?: string; extra?: Record<string, unknown> } = {}
) =>
  createBill({
    creator,
    name,
    items: [{ name: 'Everything', price: total, quantity: 1 }],
    groupId: opts.groupId ?? null,
    extra: { split_mode: 'even', ...opts.extra },
  });

async function build(): Promise<Scenario> {
  const alice = await createUser('alice', 'Alice');
  const bob = await createUser('bob', 'Bob');
  const carol = await createUser('carol', 'Carol');
  const dan = await createUser('dan', 'Dan');
  await setProfile(bob, {
    venmo_handle: '@bob-venmo',
    cashapp_handle: '$bobcash',
    paypal_handle: 'bob-paypal',
    zelle_handle: 'bob-zelle@example.com',
  });
  await setProfile(carol, { venmo_handle: '@carol-venmo' });
  const group = await createGroup(dan, [alice, bob, carol]);
  const bills: Record<string, string> = {};

  // Bob collects; Alice owes 10; a guest typed "Alice" (same name, no account) owes 10
  const b1 = await evenBill(bob, 'Bob pays', 30, { groupId: group.id, extra: { venmo_handle: '@EVIL-bill-handle' } });
  await joinBill(b1.id, { name: 'Alice', user: alice });
  await joinBill(b1.id, { name: 'Alice' });
  bills.bobPays = b1.id;

  // Alice collects 12 over three: Bob (linked) owes 4; a guest named like Carol owes 4
  const b2 = await evenBill(alice, 'Alice pays', 12);
  await joinBill(b2.id, { name: 'Bob', user: bob });
  await joinBill(b2.id, { name: 'Carol' });
  bills.alicePays = b2.id;

  // Carol collects; Alice owes 4
  const b3 = await evenBill(carol, 'Carol pays', 8, { groupId: group.id });
  await joinBill(b3.id, { name: 'Alice', user: alice });
  bills.carolPays = b3.id;

  // Dan hosts but Bob paid ("paid by"): Dan and Alice each owe Bob 10
  const b5 = await evenBill(dan, 'Bob fronted', 20, { extra: { paid_by_user_id: bob.id } });
  await joinBill(b5.id, { name: 'Alice', user: alice });
  bills.bobFronted = b5.id;

  // Alice's share already marked paid, a settled bill and an unpublished one: none count
  const b6 = await evenBill(bob, 'Already paid', 20);
  const paid = await joinBill(b6.id, { name: 'Alice', user: alice });
  await db().from('participants').update({ payment_status: 'paid' }).eq('id', paid.id);
  const b7 = await evenBill(bob, 'Settled', 20, { extra: { status: 'settled' } });
  await joinBill(b7.id, { name: 'Alice', user: alice });
  const b8 = await evenBill(bob, 'Not approved', 20, { extra: { approval_required: true, approved_at: null } });
  await joinBill(b8.id, { name: 'Alice', user: alice });

  const { token } = await insertToken(alice);
  return { alice, bob, carol, dan, token, groupId: group.id, bills };
}

let s: Scenario;
beforeAll(async () => {
  s = await build();
});

type Row = { label: string; untrusted_name: string; direction: string; amount: number; pay_with?: Record<string, string> };
const balances = async (args: Record<string, unknown> = {}) => {
  const res = await callTool(s.token, 'get_balances', args);
  expect(res.isError).toBe(false);
  return res.data as {
    as_of: string;
    scope: string;
    balances: Row[];
    unverified: { kind: string; bill_id: string; amount: number }[];
    notes: string[];
  };
};

describe('get_balances', () => {
  it('nets only account-linked rows over related, published, unsettled, unpaid shares', async () => {
    const out = await balances();
    // Bob: Alice owes 10 (bobPays) + 10 (bobFronted), Bob owes Alice 4. Carol: Alice owes 4.
    expect(out.balances.map((b) => [b.untrusted_name, b.direction, b.amount])).toEqual([
      ['Bob', 'you_owe', 16],
      ['Carol', 'you_owe', 4],
    ]);
    expect(out.balances.map((b) => b.label)).toEqual(['person #1', 'person #2']);
    expect(out.scope).toBe('all');
    expect(new Date(out.as_of).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('puts a nameless row on a bill you collect, and a row named like you, in unverified', async () => {
    const out = await balances();
    expect(out.unverified).toEqual(
      expect.arrayContaining([
        { kind: 'name_matches_you', bill_id: s.bills.bobPays, amount: 10 },
        // the guest named "Carol" on Alice's bill is not Carol: it never reaches Carol's balance
        { kind: 'guest_owes_you', bill_id: s.bills.alicePays, amount: 4 },
      ])
    );
    expect(out.unverified).toHaveLength(2);
    expect(JSON.stringify(out.unverified)).not.toMatch(/pay_with|venmo|handle/i);
  });

  it('gives payment handles from the creditor\'s profile only, never Zelle or a bill\'s own handle', async () => {
    const out = await balances();
    const bob = out.balances.find((b) => b.untrusted_name === 'Bob')!;
    expect(bob.pay_with).toEqual({ venmo: '@bob-venmo', cashapp: '$bobcash', paypal: 'bob-paypal' });
    const carol = out.balances.find((b) => b.untrusted_name === 'Carol')!;
    expect(carol.pay_with).toEqual({ venmo: '@carol-venmo' });
    const text = JSON.stringify(out);
    expect(text).not.toContain('EVIL-bill-handle');
    expect(text).not.toMatch(/zelle/i);
    expect(text).not.toContain('bob-zelle@example.com');
  });

  it('gives no handle when the other person owes you', async () => {
    // Bob owes Alice more than she owes him once Alice's bill is large
    const big = await evenBill(s.alice, 'Big', 400);
    await joinBill(big.id, { name: 'Bob', user: s.bob });
    try {
      const bob = (await balances()).balances.find((b) => b.untrusted_name === 'Bob')!;
      expect(bob.direction).toBe('owes_you');
      expect(bob.amount).toBe(184); // 200 + 4 - 20
      expect(bob).not.toHaveProperty('pay_with');
    } finally {
      await db().from('bills').delete().eq('id', big.id);
    }
  });

  it('scopes to one group', async () => {
    const out = await balances({ group_id: s.groupId });
    expect(out.scope).toBe('group');
    expect(out.balances.map((b) => [b.untrusted_name, b.amount])).toEqual([
      ['Bob', 10],
      ['Carol', 4],
    ]);
    // the guest on bobPays named like Alice is still reported; Alice's own bill is outside the group
    expect(out.unverified).toEqual([{ kind: 'name_matches_you', bill_id: s.bills.bobPays, amount: 10 }]);
  });

  it('two counterparties with the same display name lose their handles', async () => {
    await setProfile(s.carol, { display_name: 'bob' });
    try {
      const out = await balances();
      expect(out.balances).toHaveLength(2);
      for (const row of out.balances) expect(row).not.toHaveProperty('pay_with');
      expect(out.notes.join(' ')).toMatch(/share a display name/);
    } finally {
      await setProfile(s.carol, { display_name: 'Carol' });
    }
  });

  it('a person who only shares a name with a member never inherits their debts or handle', async () => {
    // an outsider's bill with an anonymous participant named "Bob": nothing about Bob changes
    const outsider = await createUser('outsider');
    const bill = await evenBill(outsider, 'Elsewhere', 50);
    await joinBill(bill.id, { name: 'Bob' });
    await joinBill(bill.id, { name: 'Alice', user: s.alice });
    const out = await balances();
    expect(out.balances.find((b) => b.untrusted_name === 'Bob')!.amount).toBe(16);
    expect(out.balances.find((b) => b.untrusted_name === 'Bob')!.pay_with).toBeDefined();
    // Alice owes the outsider 16.67; the outsider has no handle on file
    expect(out.balances.some((b) => b.amount === 16.67 && b.direction === 'you_owe' && !b.pay_with)).toBe(true);
  });
});
