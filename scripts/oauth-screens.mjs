#!/usr/bin/env node
// Walks the connect-Claude screens in a real browser against a LOCAL server and
// saves a screenshot of every state to docs/specs/screens/oauth-*.png.
//
//   export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
//   source scripts/local-env.sh
//   npx next dev -p 3199 > /tmp/splittr-screens-next.log 2>&1 &
//   E2E_SERVER_LOG=/tmp/splittr-screens-next.log VIEWPORT=mobile node scripts/oauth-screens.mjs
//   E2E_SERVER_LOG=/tmp/splittr-screens-next.log VIEWPORT=desktop node scripts/oauth-screens.mjs
//
// The local stack must run its mail catcher (Mailpit, http://127.0.0.1:54324): sign-in codes
// are read from the email Supabase sends. The consent code is read from the server log.
// Local only; creates and deletes throwaway oauth-screens-*@example.test users.
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { chromium } from '@playwright/test';

const ISSUER = 'http://localhost:3199';
const MAIL = 'http://127.0.0.1:54324';
const CLAUDE_CODE_CLIENT = 'https://claude.ai/oauth/claude-code-client-metadata';
const HOSTED_CLIENT = 'https://claude.ai/oauth/mcp-oauth-client-metadata';
const HOSTED_REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const SERVER_LOG = process.env.E2E_SERVER_LOG;
const MODE = process.env.VIEWPORT === 'desktop' ? 'desktop' : 'mobile';
const SIZE = MODE === 'desktop' ? { width: 1280, height: 900 } : { width: 390, height: 844 };
const OUT = new URL('../docs/specs/screens/', import.meta.url).pathname;

if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321' || process.env.OAUTH_ISSUER !== ISSUER || !SERVER_LOG) {
  console.error('oauth-screens: refusing: run `source scripts/local-env.sh` and set E2E_SERVER_LOG');
  process.exit(1);
}

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `  (${detail})` : ''}`);
  return ok;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (t) => createHash('sha256').update(t).digest('base64url');
const sha256hex = (t) => createHash('sha256').update(t).digest('hex');
const form = (fields) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

async function shot(page, name, { full = true, locator = null } = {}) {
  await sleep(450); // the quiet mount fade
  const path = `${OUT}oauth-${name}-${MODE}.png`;
  if (locator) {
    // Tall sections: grow the viewport to the element, capture the viewport, restore
    const box = await locator.boundingBox();
    const size = page.viewportSize();
    await page.setViewportSize({ width: size.width, height: Math.ceil(box.height) + 80 });
    await locator.scrollIntoViewIfNeeded();
    await sleep(300);
    await locator.screenshot({ path });
    await page.setViewportSize(size);
  }
  else await page.screenshot({ path, fullPage: full });
  console.log(`      screenshot ${path.replace(OUT, 'docs/specs/screens/')}`);
}

async function mailCode(email, since) {
  for (let i = 0; i < 40; i += 1) {
    const list = await (await fetch(`${MAIL}/api/v1/messages`)).json();
    const hit = list.messages.find((m) => m.To.some((t) => t.Address === email) && new Date(m.Created).getTime() >= since);
    if (hit) {
      const msg = await (await fetch(`${MAIL}/api/v1/message/${hit.ID}`)).json();
      const code = /\b(\d{6})\b/.exec(msg.Text)?.[1];
      return { code, html: msg.HTML, text: msg.Text };
    }
    await sleep(300);
  }
  return null;
}
function logCode(email, notBefore = 0) {
  const re = new RegExp(`OAuth consent code for ${email.replace(/[.+]/g, '\\$&')}: (\\d{6})`, 'g');
  const all = [...readFileSync(SERVER_LOG, 'utf8').matchAll(re)];
  return all.length > notBefore ? { code: all[all.length - 1][1], count: all.length } : null;
}
const logCount = (email) => {
  const re = new RegExp(`OAuth consent code for ${email.replace(/[.+]/g, '\\$&')}: (\\d{6})`, 'g');
  return [...readFileSync(SERVER_LOG, 'utf8').matchAll(re)].length;
};

function listenLoopback() {
  return new Promise((resolve) => {
    let waiter = null;
    const seen = [];
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      res.end('You can close this window.');
      seen.push(url);
      waiter?.(url);
    });
    server.listen(0, '127.0.0.1', () =>
      resolve({
        port: server.address().port,
        next: () => new Promise((ok, bad) => {
          if (seen.length) return ok(seen.shift());
          const t = setTimeout(() => bad(new Error('loopback never called')), 15000);
          waiter = (u) => { clearTimeout(t); ok(u); };
        }),
        close: () => server.close(),
      })
    );
  });
}

async function authorizeUrl({ clientId, redirectUri }) {
  const prm = await (await fetch(`${ISSUER}/.well-known/oauth-protected-resource/api/mcp`)).json();
  const asm = await (await fetch(`${ISSUER}/.well-known/oauth-authorization-server`)).json();
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(16).toString('base64url');
  const url = new URL(asm.authorization_endpoint);
  for (const [k, v] of Object.entries({
    response_type: 'code', client_id: clientId, redirect_uri: redirectUri, code_challenge: sha(verifier),
    code_challenge_method: 'S256', state, resource: prm.resource, scope: 'read bills:write offline_access',
  })) url.searchParams.set(k, v);
  return { url: url.toString(), verifier, state, resource: prm.resource, token_endpoint: asm.token_endpoint, clientId, redirectUri };
}
async function exchange(a, code) {
  const res = await fetch(a.token_endpoint, form({ grant_type: 'authorization_code', client_id: a.clientId, code, code_verifier: a.verifier, redirect_uri: a.redirectUri, resource: a.resource }));
  return { status: res.status, body: await res.json() };
}
async function mcp(token, method = 'tools/list') {
  const res = await fetch(`${ISSUER}/api/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method }),
  });
  return res.status;
}

async function signInViaCode(page, email, next) {
  const since = Date.now() - 1000;
  await page.goto(`${ISSUER}/signin?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email').fill(email);
  return since;
}

const email = `oauth-screens-${randomBytes(3).toString('hex')}@example.test`;
const other = `oauth-screens-${randomBytes(3).toString('hex')}@example.test`;
const ids = [];
let browser;
let loopback;
try {
  for (const e of [email, other]) {
    const c = await admin.auth.admin.createUser({ email: e, email_confirm: true });
    if (c.error) throw new Error(c.error.message);
    ids.push(c.data.user.id);
  }
  const userId = ids[0];
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 2 });
  const page = await context.newPage();
  loopback = await listenLoopback();

  // ---------- (a) Claude Code, signed OUT: sign in with the code, then consent ----------
  console.log('\n(a) Claude Code flow, signed out');
  const a = await authorizeUrl({ clientId: CLAUDE_CODE_CLIENT, redirectUri: `http://localhost:${loopback.port}/callback` });
  await page.goto(a.url);
  await page.waitForURL(/\/signin\?next=/);
  check('signed out: lands on /signin?next=/oauth/consent/<id>', /next=(%2F|\/)oauth(%2F|\/)consent/.test(page.url()), page.url());
  check('sign-in leads with the code and says why', await page.getByText('keeps you in the window Claude opened').first().isVisible());
  await shot(page, 'a1-signin-leads-with-code');
  const since = Date.now() - 1000;
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await page.getByText('Check your email').waitFor();
  await shot(page, 'a2-signin-enter-code');
  const mail = await mailCode(email, since);
  check('the sign-in email (Mailpit) carries a 6-digit code', Boolean(mail?.code), mail?.text?.slice(0, 120));
  if (MODE === 'mobile' && mail) {
    const mp = await context.newPage();
    await mp.setViewportSize({ width: 480, height: 800 });
    await mp.setContent(mail.html);
    await mp.screenshot({ path: `${OUT}oauth-email-magic-link-code.png`, fullPage: true });
    console.log('      screenshot docs/specs/screens/oauth-email-magic-link-code.png');
    await mp.close();
  }
  await page.getByLabel('Enter the 6-digit code from the email').fill('000000');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByText(/not right or has expired/).waitFor();
  await shot(page, 'a3-signin-wrong-code');
  await page.getByLabel('Enter the 6-digit code from the email').fill(mail.code);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/oauth\/consent\//);
  await page.getByText('Not you? Switch account').waitFor();
  check('after the code: on the consent page, same window', /\/oauth\/consent\//.test(page.url()));
  const profile = await admin.from('profiles').select('display_name').eq('user_id', userId).maybeSingle();
  check('ensureProfile ran for the first-time user on the code path', profile.data?.display_name === email.split('@')[0], JSON.stringify(profile));
  check('consent: loopback wording, no code needed', (await page.getByText('An app on this computer, such as Claude Code').isVisible()) && (await page.getByText('You signed in a moment ago, so no extra code is needed.').isVisible()));
  await shot(page, 'a4-consent-claude-code');
  await page.getByRole('checkbox', { name: /Propose new bills/ }).check();
  await shot(page, 'a5-consent-claude-code-write-on');
  const hit = loopback.next();
  await page.getByRole('button', { name: 'Approve' }).click();
  const redirected = await hit;
  const codeA = redirected.searchParams.get('code');
  check('the loopback catcher received a code and our state', Boolean(codeA) && redirected.searchParams.get('state') === a.state, redirected.toString());
  const tokA = await exchange(a, codeA);
  check('exchanged the code for tokens', tokA.status === 200 && tokA.body.access_token?.startsWith('spl_oat_'), JSON.stringify(tokA.body).slice(0, 120));
  check('/api/mcp with that token: tools/list is 200', (await mcp(tokA.body.access_token)) === 200);

  // ---------- (b) hosted client, signed in ----------
  console.log('\n(b) hosted client, signed in');
  let capturedUrl = null;
  // Hold the navigation to claude.ai (never sent) so the "Returning" state can be photographed, then answer it locally
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await context.route('https://claude.ai/**', async (route) => {
    capturedUrl = route.request().url();
    await gate;
    await route.fulfill({ status: 200, contentType: 'text/html', body: 'captured, not sent to claude.ai' });
  });
  const b1 = await authorizeUrl({ clientId: HOSTED_CLIENT, redirectUri: HOSTED_REDIRECT });
  await page.goto(b1.url);
  await page.getByRole('button', { name: 'Send me a code' }).waitFor();
  check('hosted: heading and asker wording from the destination', (await page.getByRole('heading', { level: 1 }).textContent()) === 'Let Claude connect to Splittr?' && (await page.getByText('Claude (claude.ai, the Desktop app and the mobile apps)').isVisible()));
  await shot(page, 'b1-consent-hosted-send-code');
  const before = logCount(email);
  await page.getByRole('button', { name: 'Send me a code' }).click();
  await page.getByLabel('6-digit code').waitFor();
  await shot(page, 'b2-consent-hosted-code-input');
  const emailed = (() => { for (let i = 0; i < 20; i += 1) { const c = logCode(email, before); if (c) return c; } return null; })();
  check('consent code read from the dev server log', Boolean(emailed));
  await page.getByLabel('6-digit code').fill(emailed.code === '000000' ? '111111' : '000000');
  await page.getByRole('button', { name: 'Approve' }).click();
  await page.getByText(/tries left/).waitFor();
  check('wrong code: 4 tries left', (await page.getByText(/tries left/).textContent()).includes('4 tries left'));
  await shot(page, 'b3-consent-hosted-wrong-code');
  // fill in the right code (after a wrong code the page keeps the code step)
  await page.getByLabel('6-digit code').fill(emailed.code);
  await page.getByRole('button', { name: 'Approve' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('Returning you to Claude') || true);
  for (let i = 0; i < 40 && !capturedUrl; i += 1) await sleep(150);
  check('the redirect to claude.ai was captured, not followed', Boolean(capturedUrl) && capturedUrl.startsWith(HOSTED_REDIRECT), String(capturedUrl));
  const codeB = capturedUrl ? new URL(capturedUrl).searchParams.get('code') : null;
  check('captured URL carries code, state and iss', Boolean(codeB) && new URL(capturedUrl).searchParams.get('state') === b1.state && new URL(capturedUrl).searchParams.get('iss') === ISSUER);
  // The page is mid-navigation: a normal screenshot would wait for it, so ask the browser directly
  const cdp = await context.newCDPSession(page);
  const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(`${OUT}oauth-b4-consent-returning-${MODE}.png`, Buffer.from(png.data, 'base64'));
  console.log(`      screenshot docs/specs/screens/oauth-b4-consent-returning-${MODE}.png`);
  release();
  const tokB = await exchange(b1, codeB);
  check('hosted code exchanged; /api/mcp 200', tokB.status === 200 && (await mcp(tokB.body.access_token)) === 200);

  // Second hosted request: shows the replace option; then Deny (c)
  console.log('\n(c) deny, with an existing connection');
  capturedUrl = null;
  const c1 = await authorizeUrl({ clientId: HOSTED_CLIENT, redirectUri: HOSTED_REDIRECT });
  await page.goto(c1.url);
  await page.getByRole('checkbox', { name: /Replace my existing Claude connection from/ }).waitFor();
  check('replace option is on by default for the hosted client', await page.getByRole('checkbox', { name: /Replace my existing Claude connection from/ }).isChecked());
  await shot(page, 'c1-consent-hosted-replace');
  await page.getByRole('button', { name: 'Deny' }).click();
  for (let i = 0; i < 40 && !capturedUrl; i += 1) await sleep(150);
  check('deny redirects with error=access_denied and our state', Boolean(capturedUrl) && new URL(capturedUrl).searchParams.get('error') === 'access_denied' && new URL(capturedUrl).searchParams.get('state') === c1.state, String(capturedUrl));
  check('the denied hosted request left the first connection working', (await mcp(tokB.body.access_token)) === 200);

  // ---------- (d) gone, foreign, Not you? ----------
  console.log('\n(d) expired or foreign request');
  await page.goto(`${ISSUER}/oauth/consent/AAAAAAAAAAAAAAAAAAAAAA`);
  await page.getByText('Go back to Claude and press Connect again.').waitFor();
  check('an unknown id shows the 404 text', true);
  await shot(page, 'd1-consent-gone');
  const d1 = await authorizeUrl({ clientId: CLAUDE_CODE_CLIENT, redirectUri: `http://localhost:${loopback.port}/callback` });
  await page.goto(d1.url);
  await page.getByText('Not you? Switch account').waitFor();
  const consentPath = new URL(page.url()).pathname;
  const ctx2 = await browser.newContext({ viewport: SIZE });
  const p2 = await ctx2.newPage();
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: other });
  await p2.goto(`${ISSUER}/auth/callback?token_hash=${link.data.properties.hashed_token}&type=email`);
  await p2.goto(`${ISSUER}${consentPath}`);
  await p2.getByText('Go back to Claude and press Connect again.').waitFor();
  check('another account without the cookie sees the 404 text', true);
  await ctx2.close();
  // Not you? Switch account: sign out, back through sign-in
  await page.getByRole('button', { name: 'Not you? Switch account' }).click();
  await page.waitForURL(/\/signin\?next=/);
  check('Not you? signs out and goes to /signin?next=<this page>', page.url().includes(encodeURIComponent(consentPath)) || page.url().includes(consentPath), page.url());
  const cookiesAfter = (await context.cookies(ISSUER)).filter((c) => c.name.startsWith('sb-') && c.value);
  check('the session cookie is gone after Switch account', cookiesAfter.length === 0, cookiesAfter.map((c) => c.name).join(','));
  await shot(page, 'd2-switch-account-signin');
  // sign back in as the second account with the code, to learn what the same request does for a different account
  const since2 = Date.now() - 1000;
  await page.getByLabel('Email').fill(other);
  await page.getByRole('button', { name: 'Email me a code' }).click();
  const mail2 = await mailCode(other, since2);
  await page.getByLabel('Enter the 6-digit code from the email').fill(mail2.code);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/oauth\/consent\//);
  await sleep(1200);
  const switchedText = await page.locator('main').innerText();
  console.log(`      after switching accounts the same request shows: ${JSON.stringify(switchedText.slice(0, 160))}`);
  await shot(page, 'd3-switch-account-result');

  // sign back in as the first user for the profile steps
  await page.context().clearCookies();
  const link1 = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  await page.goto(`${ISSUER}/auth/callback?token_hash=${link1.data.properties.hashed_token}&type=email&next=/profile`);

  // ---------- (e) profile ----------
  console.log('\n(e) profile');
  await page.goto(`${ISSUER}/profile`);
  await page.getByText('Connect Claude').waitFor();
  const section = page.locator('section', { has: page.getByRole('heading', { name: 'Agent access' }) });
  await shot(page, 'e1-profile-agent-access', { locator: section });
  const grants = await admin.from('agent_tokens').select('id, oauth_destination').eq('user_id', userId).eq('kind', 'oauth');
  const hosted = grants.data.find((g) => g.oauth_destination === 'claude.ai');
  await admin.from('agent_tokens').update({ suspended_at: new Date().toISOString(), suspended_reason: 'Three bills declined in an hour' }).eq('id', hosted.id);
  await page.reload();
  await page.getByText('Paused: Three bills declined in an hour').waitFor();
  await shot(page, 'e2-profile-paused-connection', { locator: section });
  await page.getByRole('button', { name: 'Turn back on' }).click();
  await page.getByText('Paused:').waitFor({ state: 'detached' });
  check('Turn back on resumes the paused connection', (await mcp(tokB.body.access_token)) === 200);
  await page.getByRole('button', { name: 'Revoke Claude Code on a computer' }).click();
  await page.getByText('Revoke this connection?').waitFor();
  await shot(page, 'e3-profile-revoke-confirm');
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke' }).click();
  await page.getByText('Revoked by you').first().waitFor();
  check('after revoking in the profile, the next /api/mcp call with its token is 401', (await mcp(tokA.body.access_token)) === 401);
  await shot(page, 'e4-profile-after-revoke', { locator: section });

  // ---------- (f) Not you? link ----------
  console.log('\n(f) "Not you?" link');
  // The connected email cannot be delivered locally (Resend only), and only the hash of its secret is stored.
  // So give the live grant a known secret the way approve stores one (sha256 hex of the secret), and follow the link.
  const secret = randomBytes(32).toString('base64url');
  await admin.from('agent_tokens').update({ revoke_link_hash: sha256hex(secret) }).eq('id', hosted.id);
  const nu = await context.newPage();
  await nu.setViewportSize(SIZE);
  await nu.goto(`${ISSUER}/agent-tokens/revoke?s=${secret}`);
  await nu.getByRole('button', { name: 'Revoke all agent tokens' }).waitFor();
  const before2 = await mcp(tokB.body.access_token);
  await shot(nu, 'f1-not-you-link');
  await nu.getByRole('button', { name: 'Revoke all agent tokens' }).click();
  await nu.getByText(/revoked$/).first().waitFor();
  await shot(nu, 'f2-not-you-done');
  check('before the link was used the grant worked; after, /api/mcp is 401', before2 === 200 && (await mcp(tokB.body.access_token)) === 401);
} catch (error) {
  failed += 1;
  console.log(`FAIL  unexpected error: ${error instanceof Error ? error.stack : error}`);
} finally {
  loopback?.close();
  await browser?.close().catch(() => {});
  for (const id of ids) await admin.auth.admin.deleteUser(id).catch(() => {});
}
console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}  ${MODE}: ${passed} checks passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
