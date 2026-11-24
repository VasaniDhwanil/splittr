// Local only: signs in a throwaway user, opens the group Invite, Rename and bill Edit dialogs at 390 px,
// saves docs/specs/screens/invite-dialog-mobile.png and prints overflow measurements.
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:3199';
const OUT = new URL('../docs/specs/screens/', import.meta.url).pathname;
if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') { console.error('run source scripts/local-env.sh'); process.exit(1); }
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, opts);
const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, opts);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const email = `dialog-check-${randomBytes(4).toString('hex')}@example.test`;
const password = randomBytes(12).toString('base64url');
const { data: created } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
const userId = created.user.id;
const browser = await chromium.launch();
try {
  const { data } = await anon.auth.signInWithPassword({ email, password });
  const value = `base64-${Buffer.from(JSON.stringify(data.session)).toString('base64url')}`;
  const chunks = value.match(/.{1,3000}/g);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await ctx.addCookies(chunks.map((v, i) => ({ name: chunks.length === 1 ? 'sb-127-auth-token' : `sb-127-auth-token.${i}`, value: v, url: BASE })));
  const headers = { origin: BASE, 'content-type': 'application/json' };
  const g = await ctx.request.post(`${BASE}/api/groups`, { headers, data: { name: 'Lake house trip' } });
  const group = await g.json();
  const b = await ctx.request.post(`${BASE}/api/bills`, { headers, data: { name: 'Dinner', creator_name: 'Me', items: [{ name: 'Pasta', price: 12, quantity: 1 }], tax: 1, tip_percent: 18 } });
  const bill = await b.json();
  console.log('group', g.status(), 'bill', b.status());
  const page = await ctx.newPage();
  const measure = async (label) => {
    await sleep(500);
    const m = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      const inside = [...d.querySelectorAll('button,input')].every((el) => { const r = el.getBoundingClientRect(), c = d.getBoundingClientRect(); return r.left >= c.left - 0.5 && r.right <= c.right + 0.5; });
      return { doc: document.documentElement.scrollWidth, view: window.innerWidth, dialogScroll: d.scrollWidth, dialogClient: d.clientWidth, controlsInside: inside };
    });
    console.log(label, JSON.stringify(m));
    return m;
  };
  await page.goto(`${BASE}/groups/${group.id}`);
  await page.getByRole('button', { name: /Invite/ }).first().click();
  await measure('invite');
  await page.screenshot({ path: `${OUT}invite-dialog-mobile.png` });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Rename group' }).click();
  await measure('rename');
  await page.screenshot({ path: '/tmp/rename-dialog-mobile.png' });
  await page.keyboard.press('Escape');
  if (bill.id) {
    await page.goto(`${BASE}/bill/${bill.id}`);
    await page.getByRole('button', { name: 'Edit bill' }).click();
    await measure('edit-bill');
    await page.screenshot({ path: '/tmp/edit-bill-dialog-mobile.png' });
  }
} finally {
  await browser.close();
  await admin.auth.admin.deleteUser(userId);
}
