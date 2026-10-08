// Realtime doorbell probe, as anonymous guests (anon key, no account).
//
// Subscribes to the private topic bill:<id> exactly like
// src/hooks/use-bill-realtime.ts, drives changes through the API, and checks:
//   - each table's change rings `changed` with ONLY { table, bill_id }
//   - a guest cannot spoof a doorbell to other listeners
//   - private topics outside bill:* are refused
//   - (after migration 014) the public key can't list bills any more
// Creates its own bill and deletes it at the end.
//
// Usage:  BASE=http://localhost:3000 node scripts/realtime-doorbell-probe.mjs
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
const EXPECT_LOCKED = process.env.EXPECT_LOCKED === '1';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = (path, init = {}) =>
  fetch(`${BASE}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } });
const guest = () =>
  createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    realtime: { transport: WebSocket },
  });

function listen(client, topic) {
  const messages = [];
  const channel = client.channel(topic, { config: { private: true } });
  channel.on('broadcast', { event: 'changed' }, (m) => messages.push(m.payload));
  const status = new Promise((resolve) => {
    const timer = setTimeout(() => resolve('TIMEOUT'), 10000);
    channel.subscribe((s) => {
      if (s === 'SUBSCRIBED' || s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') {
        clearTimeout(timer);
        resolve(s);
      }
    });
  });
  return { channel, messages, status };
}

async function waitFor(messages, pred, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (messages.some(pred)) return true;
    await sleep(100);
  }
  return false;
}

// --- setup -----------------------------------------------------------------
const created = await api('/api/bills', {
  method: 'POST',
  body: JSON.stringify({
    name: 'Doorbell probe',
    creator_name: 'Probe',
    tax: 0,
    tip_percent: 0,
    items: [{ name: 'x', price: 10, quantity: 1 }],
  }),
}).then((r) => r.json());
const { id: billId, creator_token: token } = created;
const bill = await api(`/api/bills/${billId}`).then((r) => r.json());
const itemId = bill.items[0].id;

const alice = guest();
const bob = guest();
const a = listen(alice, `bill:${billId}`);
const b = listen(bob, `bill:${billId}`);
check('guest joins the private bill topic', (await a.status) === 'SUBSCRIBED', await a.status);
await b.status;
await sleep(1000);

// --- each table rings --------------------------------------------------------
await api(`/api/bills/${billId}`, { method: 'PATCH', headers: { 'X-Creator-Token': token }, body: JSON.stringify({ name: 'Doorbell probe 2' }) });
check('bill rename rings (bills)', await waitFor(a.messages, (m) => m?.table === 'bills' && m?.bill_id === billId));

const joined = await api('/api/participants', { method: 'POST', body: JSON.stringify({ bill_id: billId, name: 'Alice' }) }).then((r) => r.json());
check('join rings (participants)', await waitFor(a.messages, (m) => m?.table === 'participants'));

await api('/api/claims', { method: 'POST', body: JSON.stringify({ participant_id: joined.id, item_id: itemId, share: 1 }) });
check('claim rings (item_claims)', await waitFor(a.messages, (m) => m?.table === 'item_claims' && m?.bill_id === billId));

const before = a.messages.length;
await api(`/api/claims?participant_id=${joined.id}&item_id=${itemId}`, { method: 'DELETE' });
const afterUnclaim = { some: (pred) => a.messages.slice(before).some(pred) };
check('unclaim rings (item_claims delete)', await waitFor(afterUnclaim, (m) => m?.table === 'item_claims'));

await api(`/api/bills/${billId}`, {
  method: 'PATCH',
  headers: { 'X-Creator-Token': token },
  body: JSON.stringify({ items: [{ id: itemId, name: 'x', price: 10, quantity: 1 }, { name: 'y', price: 5, quantity: 1 }] }),
});
check('item edit rings (bill_items)', await waitFor(a.messages, (m) => m?.table === 'bill_items'));

// Realtime stamps each broadcast with its own message `id` (a fresh uuid);
// everything else must be exactly what the trigger sends.
const appKeys = (m) => Object.keys(m).filter((k) => k !== 'id').sort().join();
const rowIds = new Set([billId, itemId, joined.id]);
check(
  'payloads carry only table + bill_id (plus the transport message id)',
  a.messages.length > 0 && a.messages.every((m) => appKeys(m) === 'bill_id,table' && !rowIds.has(m.id)),
  JSON.stringify(a.messages.find((m) => appKeys(m) !== 'bill_id,table'))
);
check('a second guest hears the same doorbells', await waitFor(b.messages, (m) => m?.table === 'bill_items'));

// --- spoofing and topic scope -------------------------------------------------
const spoofCount = a.messages.length;
await b.channel.send({ type: 'broadcast', event: 'changed', payload: { table: 'bills', bill_id: billId, spoof: true } });
await sleep(2500);
check('a guest cannot ring the doorbell for others', !a.messages.slice(spoofCount).some((m) => m?.spoof));

const other = listen(guest(), 'group:anything');
check('private topics outside bill:* are refused', (await other.status) !== 'SUBSCRIBED', await other.status);

// --- table access ---------------------------------------------------------------
const rest = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/bills?select=id&limit=5`, {
  headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
}).then((r) => r.json()).catch(() => null);
if (EXPECT_LOCKED) {
  check('public key cannot list bills', !Array.isArray(rest) || rest.length === 0, JSON.stringify(rest)?.slice(0, 80));
}

// --- cleanup ---------------------------------------------------------------------
const delRing = a.messages.length;
await api(`/api/bills/${billId}`, { method: 'DELETE', headers: { 'X-Creator-Token': token } });
const afterDelete = { some: (pred) => a.messages.slice(delRing).some(pred) };
check('bill delete rings (bills)', await waitFor(afterDelete, (m) => m?.table === 'bills'));
await alice.removeAllChannels();
await bob.removeAllChannels();
console.log(`\n===== ${pass} passed, ${fail} failed =====`);
process.exit(fail ? 1 : 0);
