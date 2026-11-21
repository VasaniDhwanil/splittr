#!/usr/bin/env node
// Behaves like Claude against the LOCAL Supabase OAuth 2.1 server and prints
// what happens at each step. Settles the open questions in
// docs/specs/mcp-oauth.md (WP8 spike).
//
//   export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
//   npm run db:start        # local stack with [auth.oauth_server] enabled
//   node scripts/oauth-probe.mjs   # run from the repo root
//
// Local only: it refuses to run unless the API URL is http://127.0.0.1:54321.
// It never reads .env.local. It creates throwaway users and clients in the
// local database and deletes OAuth consents/sessions there on purpose.
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const LOCAL_URL = 'http://127.0.0.1:54321';
const ISSUER = `${LOCAL_URL}/auth/v1`;
const APP = 'http://localhost:3199';
const CLAUDE_REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const LOOPBACK_REDIRECT = 'http://localhost:53123/callback';
const RESOURCE = 'https://www.splittr.cash/api/mcp';

// ---- environment -----------------------------------------------------------

function localEnv() {
  const raw = execFileSync('npx', ['-y', 'supabase@2.122.0', 'status', '-o', 'env'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const vars = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/);
    if (m) vars[m[1]] = m[2];
  }
  return vars;
}

const env = localEnv();
if (env.API_URL !== LOCAL_URL) {
  console.error(`oauth-probe: refusing: API_URL is '${env.API_URL}', expected ${LOCAL_URL}`);
  process.exit(1);
}
const ANON = env.ANON_KEY;
const admin = createClient(env.API_URL, env.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anonClient = () =>
  createClient(env.API_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

async function sql(text, params = []) {
  const client = new pg.Client({ connectionString: env.DB_URL });
  await client.connect();
  try {
    return (await client.query(text, params)).rows;
  } finally {
    await client.end();
  }
}

// ---- helpers ---------------------------------------------------------------

let stepNo = 0;
const step = (n, title) => {
  stepNo = n;
  console.log(`\n=== Step ${n}: ${title}`);
};
const wanted = () => true;
const shorten = (_k, v) => (typeof v === 'string' && v.length > 60 && v.startsWith('eyJ') ? `${v.slice(0, 12)}... (${v.length} chars)` : v);
const show = (label, value) =>
  console.log(`  ${label}:`, typeof value === 'string' ? value : JSON.stringify(value, shorten, 2).replace(/\n/g, '\n  '));

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const sha256 = (s) => createHash('sha256').update(s).digest();
const pkce = () => {
  const verifier = b64(randomBytes(32));
  return { verifier, challenge: b64(sha256(verifier)) };
};
const decodeJwt = (jwt) => {
  const [h, p] = jwt.split('.');
  return { header: JSON.parse(Buffer.from(h, 'base64url')), payload: JSON.parse(Buffer.from(p, 'base64url')) };
};
const pickClaims = (payload) =>
  Object.fromEntries(
    ['iss', 'aud', 'role', 'sub', 'client_id', 'session_id', 'scope', 'amr', 'exp', 'iat', 'aal', 'is_anonymous'].map(
      (k) => [k, payload[k]]
    )
  );

async function readBody(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 400);
  }
}
const form = (obj) => new URLSearchParams(obj).toString();

async function http(method, url, { headers = {}, body, redirect = 'follow' } = {}) {
  const res = await fetch(url, { method, headers, body, redirect });
  return { status: res.status, location: res.headers.get('location'), headers: res.headers, body: await readBody(res) };
}

async function userSession(label, type = 'magiclink') {
  const email = `probe-${label}-${randomBytes(3).toString('hex')}@test.local`;
  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (created.error) throw created.error;
  return { id: created.data.user.id, email, ...(await signIn(email, type)) };
}
async function signIn(email, type = 'magiclink') {
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (link.error) throw link.error;
  const client = anonClient();
  const verified = await client.auth.verifyOtp({ type, token_hash: link.data.properties.hashed_token });
  if (verified.error) throw verified.error;
  return { client, session: verified.data.session };
}

async function register(redirectUri, { withApikey = false, name = 'Probe Claude' } = {}) {
  const headers = { 'content-type': 'application/json', ...(withApikey ? { apikey: ANON } : {}) };
  const res = await http('POST', `${ISSUER}/oauth/clients/register`, {
    headers,
    body: JSON.stringify({
      client_name: name,
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  });
  return res;
}

function authorizeUrl(clientId, redirectUri, challenge, extra = {}) {
  const u = new URL(`${ISSUER}/oauth/authorize`);
  const params = {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'state-' + randomBytes(4).toString('hex'),
    scope: 'email offline_access',
    resource: RESOURCE,
    ...extra,
  };
  for (const [k, v] of Object.entries(params)) if (v !== null) u.searchParams.set(k, v);
  return u.toString();
}

const bearer = (token) => ({ apikey: ANON, authorization: `Bearer ${token}` });

async function startAuthorization(client, extra) {
  const { verifier, challenge } = pkce();
  const res = await http('GET', authorizeUrl(client.client_id, client.redirect, challenge, extra), { redirect: 'manual' });
  const loc = res.location ? new URL(res.location, ISSUER) : null;
  return { res, loc, authorizationId: loc?.searchParams.get('authorization_id') ?? null, verifier };
}

const getDetails = (accessToken, id) => http('GET', `${ISSUER}/oauth/authorizations/${id}`, { headers: bearer(accessToken) });
const consent = (accessToken, id, action) =>
  http('POST', `${ISSUER}/oauth/authorizations/${id}/consent`, {
    headers: { ...bearer(accessToken), 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  });

async function exchange(client, code, verifier, { withApikey = false, withResource = true } = {}) {
  return http('POST', `${ISSUER}/oauth/token`, {
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...(withApikey ? { apikey: ANON } : {}) },
    body: form({
      grant_type: 'authorization_code',
      code,
      redirect_uri: client.redirect,
      client_id: client.client_id,
      code_verifier: verifier,
      ...(withResource ? { resource: RESOURCE } : {}),
    }),
  });
}
const refresh = (client, refreshToken) =>
  http('POST', `${ISSUER}/oauth/token`, {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: client.client_id }),
  });

/** Full Claude-like connection: authorize, (details), approve if asked, exchange. */
async function connect(user, client) {
  const auth = await startAuthorization(client);
  const details = await getDetails(user.session.access_token, auth.authorizationId);
  let redirectUrl = details.body?.redirect_url;
  if (!redirectUrl) redirectUrl = (await consent(user.session.access_token, auth.authorizationId, 'approve')).body?.redirect_url;
  const code = new URL(redirectUrl).searchParams.get('code');
  const token = await exchange(client, code, auth.verifier);
  return { auth, details, token };
}

const clearConsents = (userId, clientId) =>
  sql('delete from auth.oauth_consents where user_id = $1 and client_id = $2', [userId, clientId]);

// ---- steps -----------------------------------------------------------------

const state = {};

async function main() {
  // 1. Discovery
  step(1, 'discovery documents');
  if (wanted()) {
    const docs = {
      'RFC 8414 (path insertion, as Claude tries first)': `${LOCAL_URL}/.well-known/oauth-authorization-server/auth/v1`,
      'RFC 8414 (under issuer)': `${ISSUER}/.well-known/oauth-authorization-server`,
      'OpenID configuration (under issuer)': `${ISSUER}/.well-known/openid-configuration`,
      'OpenID configuration (path insertion)': `${LOCAL_URL}/.well-known/openid-configuration/auth/v1`,
      'OpenID configuration (origin root)': `${LOCAL_URL}/.well-known/openid-configuration`,
    };
    for (const [label, url] of Object.entries(docs)) {
      const res = await http('GET', url);
      const b = res.body;
      console.log(`  ${label}: ${url} -> ${res.status}`);
      if (res.status === 200 && typeof b === 'object') {
        for (const k of [
          'issuer',
          'registration_endpoint',
          'scopes_supported',
          'code_challenge_methods_supported',
          'token_endpoint_auth_methods_supported',
          'client_id_metadata_document_supported',
        ])
          show(`    ${k}`, b[k] === undefined ? '(absent)' : b[k]);
      }
    }
  }

  // 2. DCR
  step(2, 'dynamic client registration');
  const clients = {};
  {
    const cases = [
      ['claude.ai, no apikey', CLAUDE_REDIRECT, false],
      ['claude.ai, with apikey', CLAUDE_REDIRECT, true],
      ['loopback, no apikey', LOOPBACK_REDIRECT, false],
    ];
    for (const [label, redirect, withApikey] of cases) {
      const res = await register(redirect, { withApikey });
      console.log(`  ${label}: ${res.status}`);
      show('    body', res.body);
      if (res.status < 300 && res.body?.client_id) clients[label] = { client_id: res.body.client_id, redirect };
    }
    state.web = clients['claude.ai, no apikey'];
    state.loop = clients['loopback, no apikey'];
    // A non-https, non-loopback redirect: does Supabase refuse it?
    const bad = await register('http://evil.example.com/cb');
    console.log(`  non-https, non-loopback redirect: ${bad.status}`);
    show('    body', bad.body);
  }
  if (!state.web) throw new Error('registration failed; cannot continue');

  // 3. Authorize
  step(3, 'authorize with PKCE S256, state, scope and resource');
  const user = await userSession('main');
  state.user = user;
  {
    const a = await startAuthorization(state.web);
    console.log(`  authorize with resource: ${a.res.status}`);
    show('    location', a.res.location ?? a.res.body);
    const again = await startAuthorization(state.loop);
    console.log(`  loopback client authorize: ${again.res.status}`);
    show('    location', again.res.location ?? again.res.body);
    const noRes = await startAuthorization(state.web, { resource: null });
    console.log(`  authorize WITHOUT resource: ${noRes.res.status}`);
    const weird = await startAuthorization(state.web, { resource: 'not a url' });
    console.log(`  authorize with resource='not a url': ${weird.res.status}`);
    show('    location', weird.res.location ?? weird.res.body);
    const badRedirect = new URL(authorizeUrl(state.web.client_id, 'https://claude.ai/other', pkce().challenge));
    const br = await http('GET', badRedirect.toString(), { redirect: 'manual' });
    console.log(`  authorize with an unregistered redirect_uri: ${br.status}`);
    show('    body/location', br.location ?? br.body);
    state.authId = a.authorizationId;
    state.verifier = a.verifier;
  }

  // 4. Details + approve
  step(4, 'getAuthorizationDetails and approve as a signed-in user');
  {
    show('user session amr', pickClaims(decodeJwt(user.session.access_token).payload).amr);
    const d = await getDetails(user.session.access_token, state.authId);
    console.log(`  GET /oauth/authorizations/{id}: ${d.status}`);
    show('    body', d.body);
    const noJwt = await http('GET', `${ISSUER}/oauth/authorizations/${state.authId}`, { headers: { apikey: ANON } });
    console.log(`  same call without a user JWT: ${noJwt.status}`);
    show('    body', noJwt.body);
    const other = await userSession('other');
    const asOther = await getDetails(other.session.access_token, state.authId);
    console.log(`  same call as a DIFFERENT user (pending request is unowned until first read?): ${asOther.status}`);
    show('    body', asOther.body);
    const a = await consent(user.session.access_token, state.authId, 'approve');
    console.log(`  POST consent approve: ${a.status}`);
    show('    body', a.body);
    state.redirectUrl = a.body?.redirect_url;
    if (state.redirectUrl) {
      const u = new URL(state.redirectUrl);
      show('    redirect params', Object.fromEntries(u.searchParams));
      state.code = u.searchParams.get('code');
    }
  }

  // 5. Token exchange
  step(5, 'token endpoint, form body, no apikey');
  {
    const t = await exchange(state.web, state.code, state.verifier);
    console.log(`  POST /oauth/token (no apikey): ${t.status}`);
    const redacted = { ...t.body };
    for (const k of ['access_token', 'refresh_token', 'id_token']) if (redacted[k]) redacted[k] = `${String(redacted[k]).slice(0, 12)}... (${String(redacted[k]).length} chars)`;
    show('    body (tokens shortened)', redacted);
    if (t.body?.access_token) {
      const { header, payload } = decodeJwt(t.body.access_token);
      show('    JWT header', header);
      show('    JWT payload', pickClaims(payload));
      show('    all payload keys', Object.keys(payload));
      state.tokens = t.body;
    }
    const replay = await exchange(state.web, state.code, state.verifier);
    console.log(`  replaying the same code: ${replay.status}`);
    show('    body', replay.body);
  }

  // 6. Auto-approve
  step(6, 'second and third authorization for the same client and user');
  {
    const a2 = await startAuthorization(state.web);
    const d2 = await getDetails(user.session.access_token, a2.authorizationId);
    console.log(`  second authorization, details: ${d2.status}`);
    show('    body', d2.body);
    if (d2.body?.redirect_url) {
      const code = new URL(d2.body.redirect_url).searchParams.get('code');
      const t = await exchange(state.web, code, a2.verifier);
      console.log(`  the auto-approved code exchanges: ${t.status} (refresh token present: ${Boolean(t.body?.refresh_token)})`);
    }
    const consents = await sql('select user_id, client_id, scopes, granted_at, revoked_at from auth.oauth_consents where user_id = $1', [user.id]);
    show('    auth.oauth_consents rows', consents);
    const del = await clearConsents(user.id, state.web.client_id);
    console.log(`  deleted stored consent for (user, client)`);
    const a3 = await startAuthorization(state.web);
    const d3 = await getDetails(user.session.access_token, a3.authorizationId);
    console.log(`  third authorization, details: ${d3.status}`);
    show('    body', d3.body);
    // Scope widening: consent exists for 'email offline_access'; ask for more.
    await consent(user.session.access_token, a3.authorizationId, 'approve');
    const a4 = await startAuthorization(state.web, { scope: 'email offline_access profile' });
    const d4 = await getDetails(user.session.access_token, a4.authorizationId);
    console.log(`  after consent, a request for MORE scopes (adds profile): ${d4.status}`);
    show('    body', d4.body);
    await clearConsents(user.id, state.web.client_id);
  }

  // 7. Refresh, rotation, reuse, revocation
  step(7, 'refresh, rotation, reuse and dead refresh tokens');
  {
    const first = (await connect(user, state.web)).token.body;
    await clearConsents(user.id, state.web.client_id);
    const r1 = await refresh(state.web, first.refresh_token);
    console.log(`  refresh with the refresh token: ${r1.status}`);
    show('    refresh_token changed', r1.body?.refresh_token !== first.refresh_token);
    show('    access_token claims', r1.body?.access_token ? pickClaims(decodeJwt(r1.body.access_token).payload) : r1.body);
    // Reuse behaviour. Generations: first -> r1 -> r2 -> r3.
    const reuse = await refresh(state.web, first.refresh_token);
    console.log(`  refresh again with the generation-0 token, immediately: ${reuse.status}`);
    show('    same successor as the first refresh', reuse.body?.refresh_token === r1.body.refresh_token);
    const r2 = await refresh(state.web, r1.body.refresh_token);
    console.log(`  refresh with the generation-1 token (normal rotation): ${r2.status}`);
    await new Promise((r) => setTimeout(r, 11_000));
    const reuseLater = await refresh(state.web, first.refresh_token);
    console.log(`  generation-0 token again, 11 s later (past the 10 s reuse interval, two generations behind): ${reuseLater.status}`);
    show('    body', reuseLater.body);
    const afterReuse = await refresh(state.web, r2.body.refresh_token);
    console.log(`  the newest refresh token afterwards: ${afterReuse.status}`);
    show('    body', afterReuse.status === 200 ? { ok: true } : afterReuse.body);
    const live = afterReuse.status === 200 ? afterReuse.body : r2.body;
    const sessions = await sql('select id, oauth_client_id, scopes from auth.sessions where user_id = $1 and oauth_client_id = $2', [user.id, state.web.client_id]);
    show('    auth.sessions rows for this client before delete', sessions.length);
    await sql('delete from auth.sessions where user_id = $1 and oauth_client_id = $2', [user.id, state.web.client_id]);
    const dead = await refresh(state.web, live.refresh_token);
    console.log(`  refresh after deleting the client's sessions: ${dead.status}`);
    show('    body', dead.body);
    const stillUser = await http('GET', `${ISSUER}/user`, { headers: bearer(live.access_token) });
    console.log(`  the already-issued access token at GET /user after session delete: ${stillUser.status}`);
    show('    body', stillUser.body?.email ?? stillUser.body);
    // The real revoke: consent present, sessions present.
    const fresh = (await connect(user, state.web)).token.body;
    const grants = await http('GET', `${ISSUER}/user/oauth/grants`, { headers: bearer(user.session.access_token) });
    console.log(`  GET /user/oauth/grants (the user's own session) with a live consent: ${grants.status}`);
    show('    body', grants.body);
    const revoke = await http('DELETE', `${ISSUER}/user/oauth/grants?client_id=${state.web.client_id}`, { headers: bearer(user.session.access_token) });
    console.log(`  DELETE /user/oauth/grants?client_id= (revokeGrant): ${revoke.status}`);
    const consents = await sql('select revoked_at from auth.oauth_consents where user_id = $1 and client_id = $2', [user.id, state.web.client_id]);
    show('    consent row after revokeGrant', consents);
    const left = await sql('select count(*)::int as n from auth.sessions where user_id = $1 and oauth_client_id = $2', [user.id, state.web.client_id]);
    show('    oauth sessions left for this client', left[0].n);
    const afterRevoke = await refresh(state.web, fresh.refresh_token);
    console.log(`  refresh after revokeGrant: ${afterRevoke.status}`);
    show('    body', afterRevoke.body);
    const atRevoke = await http('GET', `${ISSUER}/user`, { headers: bearer(fresh.access_token) });
    console.log(`  access token at GET /user after revokeGrant: ${atRevoke.status}`);
    show('    body', atRevoke.body?.code ? atRevoke.body : '(ok)');
    const next = await startAuthorization(state.web);
    const nextDetails = await getDetails(user.session.access_token, next.authorizationId);
    console.log(`  next authorization after revokeGrant asks for consent again: ${nextDetails.body?.redirect_url ? 'NO (auto-approved)' : 'yes'}`);
  }

  // 8. What does an OAuth access token do at user endpoints?
  step(8, 'GET /user, PUT /user, POST /logout with an OAuth access token');
  {
    await clearConsents(user.id, state.web.client_id);
    const { token } = await connect(user, state.web);
    const at = token.body.access_token;
    const get = await http('GET', `${ISSUER}/user`, { headers: bearer(at) });
    console.log(`  GET /user: ${get.status}`);
    show('    body', get.status === 200 ? { id: get.body.id, email: get.body.email } : get.body);
    const put = await http('PUT', `${ISSUER}/user`, {
      headers: { ...bearer(at), 'content-type': 'application/json' },
      body: JSON.stringify({ data: { probe: 'oauth-token-wrote-this' } }),
    });
    console.log(`  PUT /user (user_metadata): ${put.status}`);
    show('    body', put.status === 200 ? { user_metadata: put.body.user_metadata } : put.body);
    const putEmail = await http('PUT', `${ISSUER}/user`, {
      headers: { ...bearer(at), 'content-type': 'application/json' },
      body: JSON.stringify({ email: `changed-${randomBytes(3).toString('hex')}@test.local` }),
    });
    console.log(`  PUT /user (email change): ${putEmail.status}`);
    show('    body', putEmail.body?.new_email ? { new_email: putEmail.body.new_email } : putEmail.body);
    const factors = await http('POST', `${ISSUER}/factors`, {
      headers: { ...bearer(at), 'content-type': 'application/json' },
      body: JSON.stringify({ factor_type: 'totp' }),
    });
    console.log(`  POST /factors: ${factors.status}`);
    show('    body', factors.body);
    const pw = `probe-${randomBytes(6).toString('hex')}`;
    const putPw = await http('PUT', `${ISSUER}/user`, {
      headers: { ...bearer(at), 'content-type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    console.log(`  PUT /user (set a password): ${putPw.status}`);
    show('    body', putPw.body?.code ? putPw.body : '(accepted)');
    const pwLogin = await anonClient().auth.signInWithPassword({ email: user.email, password: pw });
    console.log(`  sign in with that password afterwards: ${pwLogin.error ? 'refused: ' + pwLogin.error.message : 'WORKS (account takeover path)'}`);
    const webAfterPw = await http('GET', `${ISSUER}/user`, { headers: bearer(user.session.access_token) });
    console.log(`  the user's own web session right after the password change: ${webAfterPw.status}`);
    const oauthAfterPw = await http('GET', `${ISSUER}/user`, { headers: bearer(at) });
    console.log(`  the OAuth token itself right after the password change: ${oauthAfterPw.status}`);
    Object.assign(user, await signIn(user.email));
    const userinfo = await http('GET', `${ISSUER}/oauth/userinfo`, { headers: bearer(at) });
    console.log(`  GET /oauth/userinfo: ${userinfo.status}`);
    show('    body', userinfo.body);
    for (const table of ['profiles', 'bills', 'participants', 'agent_tokens', 'groups']) {
      const rest = await http('GET', `${LOCAL_URL}/rest/v1/${table}?select=*&limit=1`, { headers: bearer(at) });
      console.log(`  PostgREST GET /rest/v1/${table} as the OAuth token: ${rest.status} ${Array.isArray(rest.body) ? `(${rest.body.length} rows)` : JSON.stringify(rest.body).slice(0, 120)}`);
    }
    const logoutLocal = await http('POST', `${ISSUER}/logout?scope=local`, { headers: bearer(at) });
    console.log(`  POST /logout?scope=local: ${logoutLocal.status}`);
    show('    body', logoutLocal.body);
    const afterLocal = await http('GET', `${ISSUER}/user`, { headers: bearer(at) });
    console.log(`  GET /user after that logout: ${afterLocal.status}`);
    const web = await http('GET', `${ISSUER}/user`, { headers: bearer(user.session.access_token) });
    console.log(`  the user's own web session still works: ${web.status}`);
    // Global logout with a fresh OAuth token: does it kill the first-party session too?
    await clearConsents(user.id, state.web.client_id);
    const second = (await connect(user, state.web)).token.body.access_token;
    const logoutGlobal = await http('POST', `${ISSUER}/logout`, { headers: bearer(second) });
    console.log(`  POST /logout (default scope=global): ${logoutGlobal.status}`);
    show('    body', logoutGlobal.body);
    const webAfter = await http('GET', `${ISSUER}/user`, { headers: bearer(user.session.access_token) });
    console.log(`  the user's own web session after that: ${webAfter.status}`);
    const meta = await admin.auth.admin.getUserById(user.id);
    show('    user_metadata now (admin view)', meta.data.user?.user_metadata);
    show('    email now (admin view)', { email: meta.data.user?.email, new_email: meta.data.user?.new_email ?? null });
  }

  // 9. Deny
  step(9, 'deny path');
  {
    const u2 = await userSession('deny');
    for (const [label, client] of [['claude.ai client', state.web], ['loopback client', state.loop]]) {
      const a = await startAuthorization(client);
      const d = await getDetails(u2.session.access_token, a.authorizationId);
      const res = await consent(u2.session.access_token, a.authorizationId, 'deny');
      console.log(`  deny (${label}): ${res.status}`);
      show('    redirect_url', res.body?.redirect_url ?? res.body);
      show('    details.redirect_uri was', d.body?.redirect_uri ?? '(absent)');
      const again = await consent(u2.session.access_token, a.authorizationId, 'approve');
      console.log(`  approving after deny: ${again.status}`);
      show('    body', again.body);
    }
    // Approve with an authorization that belongs to another user.
    const a = await startAuthorization(state.web);
    await getDetails(u2.session.access_token, a.authorizationId);
    const intruder = await userSession('intruder');
    const steal = await consent(intruder.session.access_token, a.authorizationId, 'approve');
    console.log(`  another user approving u2's authorization: ${steal.status}`);
    show('    body', steal.body);
  }

  // 10. Session freshness and amr
  step(10, 'amr and session freshness for the step-up option');
  {
    const email = `probe-amr-${randomBytes(3).toString('hex')}@test.local`;
    await admin.auth.admin.createUser({ email, email_confirm: true });
    for (const type of ['magiclink', 'email']) {
      const s = await signIn(email, type);
      const p = decodeJwt(s.session.access_token).payload;
      console.log(`  verifyOtp type='${type}': amr=${JSON.stringify(p.amr)} iat=${p.iat} aal=${p.aal}`);
    }
    const s = await signIn(email, 'magiclink');
    const before = decodeJwt(s.session.access_token).payload;
    show('amr before refresh', before.amr);
    console.log('  waiting 5 s, then refreshing the session...');
    await new Promise((r) => setTimeout(r, 5_000));
    const refreshed = await s.client.auth.refreshSession();
    const after = decodeJwt(refreshed.data.session.access_token).payload;
    show('amr after refresh', after.amr);
    console.log(`  iat before ${before.iat}, after ${after.iat}; the otp timestamp ${JSON.stringify(before.amr) === JSON.stringify(after.amr) ? 'is unchanged' : 'CHANGED'} by a refresh`);
    const sessionRow = await sql('select id, created_at, refreshed_at, aal from auth.sessions where id = $1', [before.session_id]);
    show('auth.sessions row', sessionRow);
    const amrRows = await sql('select authentication_method, created_at, updated_at from auth.mfa_amr_claims where session_id = $1', [before.session_id]);
    show('auth.mfa_amr_claims rows', amrRows);
  }
}

main()
  .then(() => console.log('\nprobe finished'))
  .catch((err) => {
    console.error(`\nprobe failed at step ${stepNo}:`, err);
    process.exitCode = 1;
  });
