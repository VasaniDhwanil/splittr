// Fetch a live bill over the API and verify the ledger credits the payer.
// Usage: npx tsx scripts/paidby-e2e-check.ts <billId> <perspectiveUserId>
import { computeGroupLedger, netBalancesFor } from '../src/lib/balances';
import type { BillDetail } from '../src/lib/balances';
import { GroupMember } from '../src/types';

const [billId, meUid] = process.argv.slice(2);
const base = process.env.BASE || 'http://localhost:3000';

const run = async () => {
  const bill = (await (await fetch(`${base}/api/bills/${billId}`)).json()) as BillDetail & {
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
