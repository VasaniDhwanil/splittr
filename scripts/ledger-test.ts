import { computeGroupLedger, netBalancesFor } from '../src/lib/balances';
import type { BillDetail } from '../src/lib/balances';
import { GroupMember } from '../src/types';

const ME = 'user-me', P1 = 'user-p1';
const members: GroupMember[] = [
  { id: 'm1', group_id: 'g', user_id: ME, display_name: 'Me', role: 'owner', created_at: '' },
  { id: 'm2', group_id: 'g', user_id: P1, display_name: 'Person One', role: 'member', created_at: '' },
];

function bill(id: string, hostUid: string, hostName: string, debtorUid: string | null, debtorName: string, amount: number): BillDetail {
  return {
    id, name: id, date: '', subtotal: amount, tax: 0, tip_percent: 0, tip_amount: 0,
    status: 'active', short_code: id, creator_id: null, creator_user_id: hostUid,
    split_mode: 'items', created_at: '',
    items: [{ id: `${id}-i`, bill_id: id, name: 'x', price: amount, quantity: 1, created_at: '' }],
    participants: [
      { id: `${id}-h`, bill_id: id, user_id: hostUid, name: hostName, is_creator: true, payment_status: 'unpaid', created_at: '' },
      { id: `${id}-d`, bill_id: id, user_id: debtorUid, name: debtorName, is_creator: false, payment_status: 'unpaid', created_at: '' },
    ],
    claims: [{ id: `${id}-c`, participant_id: `${id}-d`, item_id: `${id}-i`, share: 1, created_at: '' }],
  };
}

// Bill 1: P1 hosts, I owe $10. Bill 2: P1 hosts, I owe $5. Bill 3: I host, P1 owes $2.
// Bill 3 has P1 joined ANONYMOUSLY (no user_id) — tests name canonicalization.
const bills = [
  bill('b1', P1, 'Person One', ME, 'Me', 10),
  bill('b2', P1, 'Person One', ME, 'Me', 5),
  bill('b3', ME, 'Me', null, 'person one', 2),
];

const ledger = computeGroupLedger(bills, members);
const net = netBalancesFor(ledger, `u:${ME}`);
console.log(JSON.stringify(net));
if (net.length === 1 && net[0].counterparty.user_id === P1 && Math.abs(net[0].amount - 13) < 0.001) {
  console.log('PASS: net = you owe Person One $13.00');
} else {
  console.log('FAIL'); process.exit(1);
}

// Even-tip + paid participants scenario: settled shares drop out
const b4 = bill('b4', P1, 'Person One', ME, 'Me', 20);
b4.participants[1].payment_status = 'paid';
const ledger2 = computeGroupLedger([b4], members);
const net2 = netBalancesFor(ledger2, `u:${ME}`);
if (net2.length === 0) console.log('PASS: paid share drops out of ledger');
else { console.log('FAIL paid-share test', JSON.stringify(net2)); process.exit(1); }
