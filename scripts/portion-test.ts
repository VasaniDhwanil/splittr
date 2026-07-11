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
