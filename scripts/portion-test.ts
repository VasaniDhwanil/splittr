import { calculateSplits } from '../src/lib/calculations';
import { Bill, BillItem, Participant, ItemClaim } from '../src/types';

const bill: Bill = {
  id: 'b', name: 'b', date: '', subtotal: 30, tax: 0, tip_percent: 0, tip_amount: 0,
  status: 'active', short_code: 'X', creator_id: null, split_mode: 'items', created_at: '',
};
const pasta: BillItem = { id: 'i1', bill_id: 'b', name: 'Pasta', price: 30, quantity: 1, created_at: '' };
const A: Participant = { id: 'pa', bill_id: 'b', user_id: null, name: 'A', is_creator: true, created_at: '' };
const B: Participant = { id: 'pb', bill_id: 'b', user_id: null, name: 'B', is_creator: false, created_at: '' };

function totals(claims: ItemClaim[], items = [pasta], b = bill) {
  return Object.fromEntries(calculateSplits(b, items, [A, B], claims).map(s => [s.participant.id, +s.total.toFixed(2)]));
}
const c = (p: string, item: string, share: number): ItemClaim => ({ id: `${p}-${item}`, participant_id: p, item_id: item, share, created_at: '' });

// 1. Lone ½ claim pays HALF, not all (the reported bug)
let t = totals([c('pa', 'i1', 0.5)]);
console.log('lone half:', t); if (t.pa !== 15) { console.log('FAIL 1'); process.exit(1); }

// 2. ⅔ + ⅓ splits exactly
t = totals([c('pa', 'i1', 0.67), c('pb', 'i1', 0.33)]);
console.log('2/3 + 1/3:', t); if (Math.abs(t.pa - 20.1) > 0.01 || Math.abs(t.pb - 9.9) > 0.01) { console.log('FAIL 2'); process.exit(1); }

// 3. Two full claims normalize to half each
t = totals([c('pa', 'i1', 1), c('pb', 'i1', 1)]);
console.log('two fulls:', t); if (t.pa !== 15 || t.pb !== 15) { console.log('FAIL 3'); process.exit(1); }

// 4. Multi-qty: 2 of 3 beers @ $6 pays $12, not $18
const beers: BillItem = { id: 'i2', bill_id: 'b', name: 'Beer', price: 6, quantity: 3, created_at: '' };
const beerBill = { ...bill, subtotal: 18 };
t = totals([c('pa', 'i2', 2)], [beers], beerBill);
console.log('2 of 3 beers:', t); if (t.pa !== 12) { console.log('FAIL 4'); process.exit(1); }

// 5. Over-claimed multi-qty normalizes: 2 + 2 claims on qty 3
t = totals([c('pa', 'i2', 2), c('pb', 'i2', 2)], [beers], beerBill);
console.log('overclaimed beers:', t); if (t.pa !== 9 || t.pb !== 9) { console.log('FAIL 5'); process.exit(1); }

console.log('ALL PASS');

// 6. THE FRIES CASE: qty-2 fries @ $5, I take one whole + we split the second.
//    A claims 1½, B claims ½ -> A pays $7.50, B pays $2.50.
const fries: BillItem = { id: 'i3', bill_id: 'b', name: 'Fries', price: 5, quantity: 2, created_at: '' };
const friesBill = { ...bill, subtotal: 10 };
t = totals([c('pa', 'i3', 1.5), c('pb', 'i3', 0.5)], [fries], friesBill);
console.log('1½ + ½ fries:', t); if (Math.abs(t.pa - 7.5) > 0.01 || Math.abs(t.pb - 2.5) > 0.01) { console.log('FAIL 6'); process.exit(1); }

// 7. Two people split ONE of two fries, second unclaimed: ½ each of one unit = $2.50 each
t = totals([c('pa', 'i3', 0.5), c('pb', 'i3', 0.5)], [fries], friesBill);
console.log('½ + ½ of one fries:', t); if (Math.abs(t.pa - 2.5) > 0.01 || Math.abs(t.pb - 2.5) > 0.01) { console.log('FAIL 7'); process.exit(1); }

// 8. Thirds of one unit: ⅓ + ⅔ of one fries = $1.65 / $3.35
t = totals([c('pa', 'i3', 0.33), c('pb', 'i3', 0.67)], [fries], friesBill);
console.log('⅓ + ⅔ of one fries:', t); if (Math.abs(t.pa - 1.65) > 0.01 || Math.abs(t.pb - 3.35) > 0.01) { console.log('FAIL 8'); process.exit(1); }

console.log('FRACTIONAL QUANTITY PASS');

// ---- Split-sheet scenarios (batch splits, party of 12) ----
// The sheet writes equal shares of round(units/n, 4) per person; these lock
// in that the money math lands where the sheet's preview promised.

function party(n: number): Participant[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`, bill_id: 'b', user_id: null, name: `P${i}`, is_creator: i === 0, created_at: '',
  }));
}
function partyTotals(people: Participant[], claims: ItemClaim[], items: BillItem[], b: Bill) {
  return Object.fromEntries(
    calculateSplits(b, items, people, claims).map(s => [s.participant.id, +s.total.toFixed(2)])
  );
}

// 9. All 12 split one $42 fish: 12 × 0.0833 -> $3.50 each
const fish: BillItem = { id: 'i4', bill_id: 'b', name: 'Fish', price: 42, quantity: 1, created_at: '' };
const twelve = party(12);
const fishBill = { ...bill, subtotal: 42 };
let pt = partyTotals(twelve, twelve.map(p => c(p.id, 'i4', 0.0833)), [fish], fishBill);
console.log('12-way fish:', pt.p0, '×12');
for (const p of twelve) if (Math.abs(pt[p.id] - 3.5) > 0.01) { console.log('FAIL 9'); process.exit(1); }

// 10. Three-way split of 2 dumplings ($4/unit): 3 × 0.6667 -> $2.67 each
const dump: BillItem = { id: 'i5', bill_id: 'b', name: 'Dumplings', price: 4, quantity: 2, created_at: '' };
const three = party(3);
pt = partyTotals(three, three.map(p => c(p.id, 'i5', 0.6667)), [dump], { ...bill, subtotal: 8 });
console.log('3-way dumplings:', pt);
for (const p of three) if (Math.abs(pt[p.id] - 2.67) > 0.01) { console.log('FAIL 10'); process.exit(1); }

// 11. Wings qty 4 @ $7: two shared 2½ (1.25 each), two more split the
//     remaining 1½ (0.75 each) -> $8.75 / $8.75 / $5.25 / $5.25
const wings: BillItem = { id: 'i6', bill_id: 'b', name: 'Wings', price: 7, quantity: 4, created_at: '' };
const four = party(4);
pt = partyTotals(
  four,
  [c('p0', 'i6', 1.25), c('p1', 'i6', 1.25), c('p2', 'i6', 0.75), c('p3', 'i6', 0.75)],
  [wings],
  { ...bill, subtotal: 28 }
);
console.log('wings 2½ + rest:', pt);
if (Math.abs(pt.p0 - 8.75) > 0.01 || Math.abs(pt.p2 - 5.25) > 0.01) { console.log('FAIL 11'); process.exit(1); }

// 12. Single item, mixed history: one full claim + a 2-way sheet split (½ each)
//     normalizes by weight -> ½ / ¼ / ¼ of $30
const mixed = party(3);
pt = partyTotals(mixed, [c('p0', 'i1', 1), c('p1', 'i1', 0.5), c('p2', 'i1', 0.5)], [pasta], bill);
console.log('full + ½ + ½ pasta:', pt);
if (Math.abs(pt.p0 - 15) > 0.01 || Math.abs(pt.p1 - 7.5) > 0.01 || Math.abs(pt.p2 - 7.5) > 0.01) {
  console.log('FAIL 12'); process.exit(1);
}

console.log('SPLIT SHEET PASS');
