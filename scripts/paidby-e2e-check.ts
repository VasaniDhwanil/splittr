// Fetch a live bill over the API and verify the ledger credits the payer.
// Usage: COOKIE='<session cookie of a group member>' npx tsx scripts/paidby-e2e-check.ts <billId> <perspectiveUserId>
// (account ids and the member list only go to members of the bill's group)
import { computeGroupLedger, netBalancesFor } from '../src/lib/balances';
import type { BillDetail } from '../src/lib/balances';
import { GroupMember } from '../src/types';

const [billId, meUid] = process.argv.slice(2);
const base = process.env.BASE || 'http://localhost:3000';

const run = async () => {
  const headers = process.env.COOKIE ? { cookie: process.env.COOKIE } : undefined;
  const bill = (await (await fetch(`${base}/api/bills/${billId}`, { headers })).json()) as BillDetail & {
    group_members?: { user_id: string; display_name: string }[];
  };
  const members: GroupMember[] = (bill.group_members ?? []).map((m, i) => ({
    id: String(i), group_id: bill.group_id || 'g', user_id: m.user_id,
    display_name: m.display_name, role: 'member', created_at: '',
  }));
  const ledger = computeGroupLedger([bill], members);
  console.log(JSON.stringify(netBalancesFor(ledger, `u:${meUid}`)));
};
run();
