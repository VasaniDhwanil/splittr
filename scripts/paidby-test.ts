// paid_by ledger semantics: debts flow to whoever actually paid the bill.
// Run: npx tsx scripts/paidby-test.ts

import { computeGroupLedger, netBalancesFor } from '../src/lib/balances';
import type { BillDetail } from '../src/lib/balances';
import { GroupMember } from '../src/types';

const A = 'user-a', B = 'user-b', C = 'user-c';
const members: GroupMember[] = [
  { id: 'ma', group_id: 'g', user_id: A, display_name: 'Alice', role: 'owner', created_at: '' },
  { id: 'mb', group_id: 'g', user_id: B, display_name: 'Bob', role: 'member', created_at: '' },
  { id: 'mc', group_id: 'g', user_id: C, display_name: 'Cara', role: 'member', created_at: '' },
];

let failures = 0;
function expect(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`PASS: ${name}`);
  else { console.log(`FAIL: ${name} ${detail}`); failures++; }
}

/** Bill created by Alice with three $10 items, one claimed by each person. */
function threeWayBill(id: string, paidBy: string | null): BillDetail {
  return {
    id, name: id, date: '', subtotal: 30, tax: 0, tip_percent: 0, tip_amount: 0,
    status: 'active', short_code: id, creator_id: null, creator_user_id: A,
    split_mode: 'items', created_at: '', paid_by_user_id: paidBy,
    items: [
      { id: `${id}-i1`, bill_id: id, name: 'x', price: 10, quantity: 1, created_at: '' },
      { id: `${id}-i2`, bill_id: id, name: 'y', price: 10, quantity: 1, created_at: '' },
      { id: `${id}-i3`, bill_id: id, name: 'z', price: 10, quantity: 1, created_at: '' },
    ],
    participants: [
      { id: `${id}-pa`, bill_id: id, user_id: A, name: 'Alice', is_creator: true, payment_status: 'unpaid', created_at: '' },
      { id: `${id}-pb`, bill_id: id, user_id: B, name: 'Bob', is_creator: false, payment_status: 'unpaid', created_at: '' },
      { id: `${id}-pc`, bill_id: id, user_id: C, name: 'Cara', is_creator: false, payment_status: 'unpaid', created_at: '' },
    ],
    claims: [
      { id: `${id}-c1`, participant_id: `${id}-pa`, item_id: `${id}-i1`, share: 1, created_at: '' },
      { id: `${id}-c2`, participant_id: `${id}-pb`, item_id: `${id}-i2`, share: 1, created_at: '' },
      { id: `${id}-c3`, participant_id: `${id}-pc`, item_id: `${id}-i3`, share: 1, created_at: '' },
    ],
  };
}

// 1. Legacy: no payer set -> Bob and Cara each owe creator Alice $10
{
  const net = netBalancesFor(computeGroupLedger([threeWayBill('b1', null)], members), `u:${A}`);
  const owedToAlice = net.filter((n) => n.amount < 0).reduce((s, n) => s - n.amount, 0);
  expect('no payer: creator is owed $20', Math.abs(owedToAlice - 20) < 0.001, JSON.stringify(net));
}

// 2. Bob paid on Alice's bill -> Alice owes Bob $10, Cara owes Bob $10, Bob owes nothing
{
  const ledger = computeGroupLedger([threeWayBill('b2', B)], members);
  const aliceNet = netBalancesFor(ledger, `u:${A}`);
  const bobNet = netBalancesFor(ledger, `u:${B}`);
  expect('payer=Bob: creator Alice owes Bob $10',
    aliceNet.length === 1 && aliceNet[0].counterparty.user_id === B && Math.abs(aliceNet[0].amount - 10) < 0.001,
    JSON.stringify(aliceNet));
  const bobOwed = bobNet.filter((n) => n.amount < 0).reduce((s, n) => s - n.amount, 0);
  const bobOwes = bobNet.filter((n) => n.amount > 0).reduce((s, n) => s + n.amount, 0);
  expect('payer=Bob: Bob is owed $20 and owes $0', Math.abs(bobOwed - 20) < 0.001 && bobOwes === 0, JSON.stringify(bobNet));
}

// 3. Payer explicitly = creator -> identical to legacy
{
  const legacy = netBalancesFor(computeGroupLedger([threeWayBill('b3', null)], members), `u:${B}`);
  const explicit = netBalancesFor(computeGroupLedger([threeWayBill('b4', A)], members), `u:${B}`);
  expect('payer=creator behaves like no payer', JSON.stringify(legacy) === JSON.stringify(explicit),
    `${JSON.stringify(legacy)} vs ${JSON.stringify(explicit)}`);
}

// 4. Payer with no items (grandma pays): everyone owes payer their full share
{
  const b = threeWayBill('b5', C);
  // Cara claims nothing; her item goes to Bob instead
  b.claims[2] = { id: 'b5-c3', participant_id: 'b5-pb', item_id: 'b5-i3', share: 1, created_at: '' };
  const net = netBalancesFor(computeGroupLedger([b], members), `u:${C}`);
  const owedToCara = net.filter((n) => n.amount < 0).reduce((s, n) => s - n.amount, 0);
  expect('payer with no items is owed the whole bill', Math.abs(owedToCara - 30) < 0.001, JSON.stringify(net));
}

// 5. Paid participants drop out even with a payer set
{
  const b = threeWayBill('b6', B);
  b.participants[2].payment_status = 'paid'; // Cara already paid Bob back
  const net = netBalancesFor(computeGroupLedger([b], members), `u:${B}`);
  const owedToBob = net.filter((n) => n.amount < 0).reduce((s, n) => s - n.amount, 0);
  expect('paid share drops out (only Alice still owes Bob $10)', Math.abs(owedToBob - 10) < 0.001, JSON.stringify(net));
}

// 6. Settled bills are ignored regardless of payer
{
  const b = threeWayBill('b7', B);
  b.status = 'settled';
  const net = netBalancesFor(computeGroupLedger([b], members), `u:${B}`);
  expect('settled bill contributes nothing', net.length === 0, JSON.stringify(net));
}

// 7. Cross-bill netting with mixed payers: Bob paid Alice's bill (+10 to Bob from Alice),
//    Alice paid her own second bill where Bob owes $10 -> the two cancel out.
{
  const ledger = computeGroupLedger([threeWayBill('b8', B), threeWayBill('b9', null)], members);
  const aliceVsBob = netBalancesFor(ledger, `u:${A}`).find((n) => n.counterparty.user_id === B);
  expect('mixed payers net to zero between Alice and Bob', aliceVsBob === undefined,
    JSON.stringify(netBalancesFor(ledger, `u:${A}`)));
}

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nAll paid_by ledger tests passed.');
