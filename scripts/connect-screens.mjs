#!/usr/bin/env node
// Saves screenshots of the /connect page and its entry points against a LOCAL server:
// docs/specs/screens/connect-*.png.
//
//   export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
//   source scripts/local-env.sh
//   npx next dev -p 3199 > /tmp/splittr-connect-next.log 2>&1 &
//   VIEWPORT=mobile node scripts/connect-screens.mjs
//   VIEWPORT=desktop node scripts/connect-screens.mjs
//
// For the "Coming soon" state, start the server with MCP_OAUTH_ENABLED=false and add
// STATE=off. Signs in by planting a session cookie for a throwaway
// connect-screens-*@example.test user (created and deleted here). Local only.
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:3199';
const MODE = process.env.VIEWPORT === 'desktop' ? 'desktop' : 'mobile';
const OFF = process.env.STATE === 'off';
const SIZE = MODE === 'desktop' ? { width: 1280, height: 900 } : { width: 390, height: 844 };
const OUT = new URL('../docs/specs/screens/', import.meta.url).pathname;
const SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL;

if (SUPABASE !== 'http://127.0.0.1:54321' || process.env.OAUTH_ISSUER !== BASE) {
  console.error('connect-screens: refusing: run `source scripts/local-env.sh` first');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(SUPABASE, process.env.SUPABASE_SERVICE_ROLE_KEY, opts);
const anon = createClient(SUPABASE, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, opts);

async function shot(page, name, locator = null) {
  await sleep(700); // the quiet mount fade
  const path = `${OUT}connect-${name}-${MODE}.png`;
  if (locator) await locator.screenshot({ path });
  else {
    // The app scrolls inside #app-scroll, so grow the viewport to the content.
    await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
    const height = await page.evaluate(() => document.getElementById('app-scroll').scrollHeight);
    await page.setViewportSize({ width: SIZE.width, height });
    await sleep(200);
    await page.screenshot({ path });
    await page.setViewportSize(SIZE);
  }
  console.log(`screenshot ${path.replace(OUT, 'docs/specs/screens/')}`);
}

function sessionCookies(session) {
  const value = `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;
  const name = 'sb-127-auth-token';
  const chunks = value.match(/.{1,3000}/g);
  return chunks.map((v, i) => ({ name: chunks.length === 1 ? name : `${name}.${i}`, value: v, url: BASE }));
}

const email = `connect-screens-${randomBytes(4).toString('hex')}@example.test`;
const password = randomBytes(12).toString('base64url');
const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (error) throw error;
const userId = created.user.id;

const browser = await chromium.launch();
try {
  const { data: signedIn, error: signInError } = await anon.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  const cookies = sessionCookies(signedIn.session);

  const open = async (signed) => {
    const context = await browser.newContext({ viewport: SIZE, reducedMotion: 'reduce' });
    if (signed) await context.addCookies(cookies);
    return { context, page: await context.newPage() };
  };

  if (OFF) {
    const { context, page } = await open(false);
    await page.goto(`${BASE}/connect`);
    await page.getByRole('heading', { name: 'Coming soon' }).waitFor();
    await shot(page, 'coming-soon');
    await context.close();
  } else {
    {
      const { context, page } = await open(false);
      await page.goto(`${BASE}/connect`);
      await page.getByRole('heading', { name: 'Use Splittr from Claude' }).waitFor();
      await shot(page, 'signed-out');
      await shot(page, 'footer', page.locator('footer'));
      await context.close();
    }
    {
      const { context, page } = await open(true);
      await page.goto(`${BASE}/connect`);
      await page.getByText('No Claude connections yet').waitFor();
      await shot(page, 'no-connections');
      await page.goto(BASE);
      await page.getByText('Use Splittr from Claude').waitFor();
      await shot(page, 'home-card');
      await context.close();
    }

    const { error: insertError } = await admin.from('agent_tokens').insert({
      user_id: userId,
      name: 'Claude',
      scopes: ['read', 'bills:write'],
      expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
      last_used_at: new Date(Date.now() - 3 * 3600000).toISOString(),
      kind: 'oauth',
      oauth_client_id: 'connect-screens',
      oauth_destination: 'claude.ai',
      oauth_status: 'live',
    });
    if (insertError) throw insertError;
    {
      const { context, page } = await open(true);
      await page.goto(`${BASE}/connect`);
      await page.getByRole('list', { name: 'Your Claude connections' }).waitFor();
      await shot(page, 'one-connection');
      await page.goto(`${BASE}/profile`);
      await page.getByRole('link', { name: 'Open the connect page' }).waitFor();
      await shot(page, 'profile-link');
      await context.close();
    }
  }
} finally {
  await browser.close();
  await admin.from('agent_tokens').delete().eq('user_id', userId);
  await admin.auth.admin.deleteUser(userId);
}
