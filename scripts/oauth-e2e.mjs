#!/usr/bin/env node
// Behaves like Claude against a LOCAL Splittr server and prints PASS/FAIL per
// step: 401 challenge, discovery documents, the authorization request, consent
// (driven through the consent APIs from inside a signed-in browser, since the
// consent page does not exist yet), code exchange, /api/mcp calls, refresh,
// revocation. Runs the flow twice: as Claude Code (loopback redirect) and as
// the hosted Claude client (emailed code required, redirect never followed).
//
//   export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
//   source scripts/local-env.sh
//   npx next dev -p 3199 > /tmp/splittr-e2e-next.log 2>&1 &
//   E2E_SERVER_LOG=/tmp/splittr-e2e-next.log node scripts/oauth-e2e.mjs
//
// Local only: refuses unless the issuer is http://localhost:3199 and the
// Supabase URL is the local stack. It never reads .env.local, never talks to
// claude.ai, and creates (then deletes) one throwaway user in the local
// database. The emailed consent code is read from the `next dev` log, where
// the consent code route prints it in development when Resend is not set up.
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { chromium } from '@playwright/test';

const ISSUER = 'http://localhost:3199';
const LOCAL_SUPABASE = 'http://127.0.0.1:54321';
const CLAUDE_CODE_CLIENT = 'https://claude.ai/oauth/claude-code-client-metadata';
const HOSTED_CLIENT = 'https://claude.ai/oauth/mcp-oauth-client-metadata';
const HOSTED_REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const RESOURCE = `${ISSUER}/api/mcp`;
const SERVER_LOG = process.env.E2E_SERVER_LOG;

// ---- safety ---------------------------------------------------------------
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (supabaseUrl !== LOCAL_SUPABASE || !serviceKey) {
  console.error(`oauth-e2e: refusing: NEXT_PUBLIC_SUPABASE_URL is '${supabaseUrl}', expected ${LOCAL_SUPABASE} (run: source scripts/local-env.sh)`);
  process.exit(1);
}
if (process.env.OAUTH_ISSUER !== ISSUER) {
  console.error(`oauth-e2e: refusing: OAUTH_ISSUER is '${process.env.OAUTH_ISSUER}', expected ${ISSUER} (run: source scripts/local-env.sh)`);
  process.exit(1);
}

// ---- reporting --------------------------------------------------------------
let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? `  (${detail})` : ''}`);
  }
  return ok;
}
class Abort extends Error {}
/** A failed step the rest of the flow depends on. */
function must(name, ok, detail = '') {
  if (!check(name, ok, detail)) throw new Abort(name);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256b64u = (text) => createHash('sha256').update(text).digest('base64url');

// ---- helpers ------------------------------------------------------------------
const form = (fields) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields).toString(),
});

async function mcp(token, method, params, id = 1) {
  const res = await fetch(`${ISSUER}/api/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // an SSE body or an empty one
  }
  return { res, json, text };
}

/** The emailed consent code, as the dev-only console fallback prints it. */
async function codeFromLog(email, notBefore) {
  for (let i = 0; i < 40; i += 1) {
    const log = readFileSync(SERVER_LOG, 'utf8');
    const matches = [...log.matchAll(new RegExp(`OAuth consent code for ${email.replace(/[.+]/g, '\\$&')}: (\\d{6})`, 'g'))];
    if (matches.length > notBefore) return { code: matches[matches.length - 1][1], count: matches.length };
    await sleep(250);
  }
  return null;
}
const codeCount = (email) =>
  [...readFileSync(SERVER_LOG, 'utf8').matchAll(new RegExp(`OAuth consent code for ${email.replace(/[.+]/g, '\\$&')}: (\\d{6})`, 'g'))].length;

/** A tiny HTTP server on a free port that records what the browser is redirected to. */
function listenForRedirect() {
  return new Promise((resolve) => {
    let waiter = null;
    const seen = [];
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      res.setHeader('content-type', 'text/plain');
      res.end('You can close this window.');
      seen.push(url);
      waiter?.(url);
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        next: () =>
          new Promise((resolveNext, reject) => {
            if (seen.length) return resolveNext(seen.shift());
            const timer = setTimeout(() => reject(new Error('the loopback server was never called')), 15000);
            waiter = (url) => {
              clearTimeout(timer);
              resolveNext(url);
            };
          }),
        close: () => server.close(),
      });
    });
  });
}

// ---- one full connection --------------------------------------------------------
async function connectAs({ label, clientId, redirectUri, loopback, page, user }) {
  console.log(`\n=== ${label} ===`);
  const dest = loopback ? 'loopback' : 'claude.ai';
  const browserJson = async (path, init) => {
    // `next dev` may navigate or reload the (404) page it just served: retry when the page moved under us
    for (let attempt = 0; ; attempt += 1) {
      try {
        await page.waitForLoadState('load');
        return await page.evaluate(
          async ([p, i]) => {
            const res = await fetch(p, i);
            let body = null;
            try {
              body = await res.json();
            } catch {
              // no body
            }
            return { status: res.status, body };
          },
          [path, init]
        );
      } catch (error) {
        if (attempt >= 4 || !/context was destroyed|navigation/i.test(String(error))) throw error;
        await sleep(500);
      }
    }
  };
  const post = (path, body) =>
    browserJson(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  // 1. the challenge an unauthenticated client sees
  const first = await mcp(null, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'oauth-e2e', version: '1' },
  });
  const challenge = first.res.headers.get('www-authenticate') ?? '';
  must('POST /api/mcp without a token is 401', first.res.status === 401, `status ${first.res.status}`);
  const metadataUrl = /resource_metadata="([^"]+)"/.exec(challenge)?.[1];
  must('the challenge carries resource_metadata', Boolean(metadataUrl), challenge);
  check('the challenge asks for scope="read bills:write" and no error', /scope="read bills:write"/.test(challenge) && !/error=/.test(challenge), challenge);

  // 2. discovery
  const prm = await (await fetch(metadataUrl)).json();
  must(
    'protected resource metadata names the resource and the authorization server',
    prm.resource === RESOURCE && prm.authorization_servers?.[0] === ISSUER,
    JSON.stringify(prm)
  );
  const asm = await (await fetch(`${prm.authorization_servers[0]}/.well-known/oauth-authorization-server`)).json();
  must(
    'authorization server metadata: S256, no secret, client id metadata documents, iss',
    asm.issuer === ISSUER &&
      asm.code_challenge_methods_supported?.includes('S256') &&
      asm.token_endpoint_auth_methods_supported?.includes('none') &&
      asm.client_id_metadata_document_supported === true &&
      asm.authorization_response_iss_parameter_supported === true &&
      typeof asm.authorization_endpoint === 'string' &&
      typeof asm.token_endpoint === 'string',
    JSON.stringify(asm)
  );

  // 3. the authorization request, as Claude builds it
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(16).toString('base64url');
  const authorizeUrl = new URL(asm.authorization_endpoint);
  for (const [k, v] of Object.entries({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: sha256b64u(verifier),
    code_challenge_method: 'S256',
    state,
    resource: prm.resource,
    scope: 'read bills:write offline_access',
  })) {
    authorizeUrl.searchParams.set(k, v);
  }
  await page.goto(authorizeUrl.toString());
  const consentUrl = new URL(page.url());
  const requestId = consentUrl.pathname.split('/').pop();
  must('the browser lands on /oauth/consent/<request id>', consentUrl.pathname.startsWith('/oauth/consent/') && /^[A-Za-z0-9_-]{22}$/.test(requestId), page.url());
  const cookies = await page.context().cookies(ISSUER);
  check(
    'a binding cookie for this request only was set (HttpOnly, per request id)',
    cookies.some((c) => c.name === `splittr-oauth-${requestId}` && c.httpOnly),
    cookies.map((c) => c.name).join(',')
  );

  // 4. consent, through the APIs the page will use
  const details = await browserJson(`/api/agent-oauth/requests/${requestId}`);
  must(
    'GET consent details: destination, requested scopes, account email, step-up',
    details.status === 200 &&
      details.body.destination === dest &&
      details.body.account_email === user.email &&
      details.body.requested_scopes?.includes('read') &&
      details.body.requested_scopes?.includes('bills:write') &&
      typeof details.body.step_up === 'object',
    JSON.stringify(details)
  );
  check(
    loopback ? 'a fresh email sign-in is enough for Claude Code' : 'the hosted client always needs the emailed code',
    loopback ? details.body.step_up.fresh_sign_in_ok === true && details.body.step_up.code_required === false : details.body.step_up.fresh_sign_in_ok === false && details.body.step_up.code_required === true,
    JSON.stringify(details.body.step_up)
  );

  const approveBody = { scopes: ['read', 'bills:write'], replace: false };
  if (!loopback) {
    const withoutCode = await post(`/api/agent-oauth/requests/${requestId}/approve`, approveBody);
    must('approving without the emailed code is refused (code_required)', withoutCode.status === 400 && withoutCode.body.code === 'code_required', JSON.stringify(withoutCode));
    const before = codeCount(user.email);
    const sent = await post(`/api/agent-oauth/requests/${requestId}/code`, {});
    must('POST code: the code is sent', sent.status === 200 && Boolean(sent.body.code_expires_at), JSON.stringify(sent));
    const found = await codeFromLog(user.email, before);
    must('the emailed code was read from the dev server log', Boolean(found), `no line in ${SERVER_LOG}`);
    const wrong = await post(`/api/agent-oauth/requests/${requestId}/approve`, { ...approveBody, code: found.code === '000000' ? '111111' : '000000' });
    check('a wrong code is refused (wrong_code, attempts left)', wrong.status === 400 && wrong.body.code === 'wrong_code' && wrong.body.attempts_left === 4, JSON.stringify(wrong));
    approveBody.code = found.code;
  }
  const approved = await post(`/api/agent-oauth/requests/${requestId}/approve`, approveBody);
  must('POST approve returns a redirect_url', approved.status === 200 && typeof approved.body.redirect_url === 'string', JSON.stringify(approved));

  // 5. the redirect back to the client
  let redirected;
  if (loopback) {
    const nextHit = loopback.next();
    await page.goto(approved.body.redirect_url).catch(() => {});
    redirected = await nextHit;
    // Back on our origin, where the profile APIs live
    await page.goto(`${ISSUER}/oauth/consent/${requestId}`);
  } else {
    // Never navigate to claude.ai: read the redirect URL ourselves
    redirected = new URL(approved.body.redirect_url);
    check('the hosted redirect points at claude.ai/api/mcp/auth_callback', `${redirected.origin}${redirected.pathname}` === HOSTED_REDIRECT, redirected.toString());
  }
  const code = redirected.searchParams.get('code');
  must('the redirect carries a code', /^[A-Za-z0-9_-]{43}$/.test(code ?? ''), redirected.toString());
  check('the redirect carries our state back', redirected.searchParams.get('state') === state);
  check('the redirect carries iss (RFC 9207)', redirected.searchParams.get('iss') === ISSUER);

  // 6. the code exchange
  const exchangeFields = { grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: redirectUri, resource: prm.resource };
  const exchange = await fetch(asm.token_endpoint, form(exchangeFields));
  const tokens = await exchange.json();
  must(
    'token endpoint: spl_oat_ access token, spl_ort_ refresh token, 3600 s, scope read bills:write',
    exchange.status === 200 &&
      tokens.access_token?.startsWith('spl_oat_') &&
      tokens.refresh_token?.startsWith('spl_ort_') &&
      tokens.token_type === 'Bearer' &&
      tokens.expires_in === 3600 &&
      tokens.scope === 'read bills:write' &&
      exchange.headers.get('cache-control') === 'no-store',
    JSON.stringify({ status: exchange.status, ...tokens, access_token: '...', refresh_token: '...' })
  );
  const retry = await (await fetch(asm.token_endpoint, form(exchangeFields))).json();
  check('a retried exchange of the same code returns the same pair (idempotent)', retry.access_token === tokens.access_token && retry.refresh_token === tokens.refresh_token);

  // 7. /api/mcp with the access token
  const init = await mcp(tokens.access_token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'oauth-e2e', version: '1' } });
  check('initialize with the access token', init.res.status === 200 && init.json?.result?.serverInfo?.name === 'splittr', init.text.slice(0, 200));
  const list = await mcp(tokens.access_token, 'tools/list', undefined, 2);
  const names = (list.json?.result?.tools ?? []).map((t) => t.name);
  check('tools/list shows the read tools and create_bill (bills:write was granted)', list.res.status === 200 && names.includes('list_my_bills') && names.includes('create_bill'), names.join(','));
  const bills = await mcp(tokens.access_token, 'tools/call', { name: 'list_my_bills', arguments: {} }, 3);
  check('tools/call list_my_bills', bills.res.status === 200 && bills.json?.result?.isError !== true && Array.isArray(JSON.parse(bills.json.result.content[0].text).bills), bills.text.slice(0, 200));

  // 8. refresh
  const refreshed = await fetch(asm.token_endpoint, form({ grant_type: 'refresh_token', client_id: clientId, refresh_token: tokens.refresh_token, resource: prm.resource }));
  const next = await refreshed.json();
  must('refresh returns a new pair', refreshed.status === 200 && next.access_token?.startsWith('spl_oat_') && next.access_token !== tokens.access_token && next.refresh_token !== tokens.refresh_token, JSON.stringify({ status: refreshed.status, error: next.error }));
  const again = await mcp(next.access_token, 'tools/list', undefined, 4);
  check('tools/list with the new access token', again.res.status === 200, `status ${again.res.status}`);

  // 9. the connection in the profile list, then revocation through the profile route
  const listed = await browserJson('/api/agent-tokens');
  const grant = (listed.body?.tokens ?? []).find((t) => t.kind === 'oauth' && t.destination === dest && t.status === 'active');
  must('GET /api/agent-tokens lists the connection (kind oauth, destination, last4 null, active)', Boolean(grant) && grant.last4 === null && grant.name === (loopback ? 'Claude Code' : 'Claude'), JSON.stringify(listed.body?.tokens));
  const revoked = await browserJson(`/api/agent-tokens/${grant.id}`, { method: 'DELETE' });
  must('DELETE /api/agent-tokens/<id> revokes it', revoked.status === 200, JSON.stringify(revoked));
  const dead = await mcp(next.access_token, 'tools/list', undefined, 5);
  check('the next /api/mcp call is 401 with invalid_token', dead.res.status === 401 && /error="invalid_token"/.test(dead.res.headers.get('www-authenticate') ?? ''), `status ${dead.res.status}`);
  const deadRefresh = await fetch(asm.token_endpoint, form({ grant_type: 'refresh_token', client_id: clientId, refresh_token: next.refresh_token }));
  const deadBody = await deadRefresh.json();
  check('the next refresh is invalid_grant', deadRefresh.status === 400 && deadBody.error === 'invalid_grant', JSON.stringify(deadBody));
}

// ---- main ---------------------------------------------------------------------
const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const email = `oauth-e2e-${randomBytes(4).toString('hex')}@example.test`;
let userId = null;
let browser = null;
let loopback = null;

try {
  if (!SERVER_LOG) throw new Error('set E2E_SERVER_LOG to the file the `next dev` output is written to');

  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (created.error) throw new Error(`could not create the test user: ${created.error.message}`);
  userId = created.data.user.id;
  const user = { id: userId, email };

  // Sign in the way scripts/api-scenario-test.sh does: a magic link minted with the service key,
  // verified by the app's own callback (a fresh email sign-in)
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (link.error) throw new Error(`generateLink failed: ${link.error.message}`);

  browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${ISSUER}/auth/callback?token_hash=${link.data.properties.hashed_token}&type=email`);
  const session = (await context.cookies(ISSUER)).some((c) => c.name.startsWith('sb-'));
  must('the browser is signed in to the local test user (magic-link callback)', session, page.url());

  loopback = await listenForRedirect();
  await connectAs({
    label: 'Claude Code (client id claude-code-client-metadata, loopback redirect)',
    clientId: CLAUDE_CODE_CLIENT,
    redirectUri: `http://localhost:${loopback.port}/callback`,
    loopback,
    page,
    user,
  });
  await connectAs({
    label: 'hosted Claude (client id mcp-oauth-client-metadata, emailed code required)',
    clientId: HOSTED_CLIENT,
    redirectUri: HOSTED_REDIRECT,
    loopback: null,
    page,
    user,
  });
} catch (error) {
  if (!(error instanceof Abort)) {
    failed += 1;
    console.log(`FAIL  unexpected error: ${error instanceof Error ? error.message : error}`);
  }
} finally {
  loopback?.close();
  await browser?.close().catch(() => {});
  if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}  ${passed} checks passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
