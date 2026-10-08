// Realtime regression probe for the bills table, as an anonymous viewer.
//
// Creates a bill through the API, subscribes with the public anon key the
// same way src/hooks/use-bill-realtime.ts does, renames the bill, and checks
// that (1) the UPDATE event arrives and (2) its payload carries no
// creator_token. Deletes the bill afterwards.
//
// Usage:  BASE=http://localhost:3000 node scripts/realtime-bills-probe.mjs
// (Node 20, run from the repo root so bare imports resolve)
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
);
const BASE = process.env.BASE || 'https://www.splittr.cash';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}

const created = await fetch(`${BASE}/api/bills`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Realtime probe',
    creator_name: 'Probe',
    tax: 0,
    tip_percent: 0,
    items: [{ name: 'x', price: 1, quantity: 1 }],
  }),
}).then((r) => r.json());
const { id, creator_token: token } = created;

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  realtime: { transport: WebSocket },
});

const event = new Promise((resolve) => {
  const timer = setTimeout(() => resolve(null), 15000);
  supabase
    .channel(`probe:${id}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bills', filter: `id=eq.${id}` }, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    })
    .subscribe(async (status) => {
      if (status !== 'SUBSCRIBED') return;
      await new Promise((r) => setTimeout(r, 1000)); // let the subscription settle server-side
      await fetch(`${BASE}/api/bills/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Creator-Token': token },
        body: JSON.stringify({ name: 'Realtime probe renamed' }),
      });
    });
});

const payload = await event;
check('anon receives the bills UPDATE event', Boolean(payload));
check('event carries the new name', payload?.new?.name === 'Realtime probe renamed', JSON.stringify(payload?.new?.name));
check('event payload has no creator_token', payload ? !('creator_token' in payload.new) : false);

await fetch(`${BASE}/api/bills/${id}`, { method: 'DELETE', headers: { 'X-Creator-Token': token } });
await supabase.removeAllChannels();
console.log(`\n===== ${pass} passed, ${fail} failed =====`);
process.exit(fail ? 1 : 0);
