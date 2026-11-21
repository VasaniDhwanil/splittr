# Spec: OAuth sign-in for the Splittr MCP server (v2)

Status: DRAFT v2, revised after adversarial review round 1 (§8). §3 is
superseded where §7 says so; build from §7.
Owner: Dhwanil
Date: 2026-11-20
Builds on: `docs/specs/mcp-server.md` (v1: personal tokens) and
`docs/specs/mcp-implementation.md` (how v1 was built).

## 1. Goal

Let a signed-in Splittr user connect Claude (claude.ai web, Desktop, mobile,
and Claude Code) to `https://www.splittr.cash/api/mcp` by signing in, instead
of pasting a personal token. Everything v1 guarantees still holds: an agent can
do at most what its owner can, limited further by scopes and the small tool
set; access is visible, revocable and bounded; writes are proposals that wait
for approval on splittr.cash.

Personal tokens stay. OAuth is a second way to get the same `Actor`.

## 2. Facts this design rests on (checked 2026-11-20)

From Claude's connector docs (authentication, troubleshooting,
lazy-authentication, add-unlisted pages on claude.com/docs/connectors):
- Claude discovers the authorization server from RFC 9728 protected resource
  metadata, pointed to by `WWW-Authenticate: Bearer resource_metadata="..."`
  on a `401` from the MCP endpoint, falling back to
  `/.well-known/oauth-protected-resource/<path>` then
  `/.well-known/oauth-protected-resource` on the MCP origin. The metadata's
  `resource` must equal the URL the user typed, including the path. Only the
  first `authorization_servers` entry is used.
- It then reads RFC 8414 metadata, falling back to
  `/.well-known/openid-configuration`; the troubleshooting page names Supabase
  Auth as serving only the latter, which works.
- Client registration: CIMD when the metadata advertises
  `client_id_metadata_document_supported` and `none` auth; otherwise DCR
  (`registration_endpoint`); or a client ID the user types in. DCR registers a
  new client on every fresh connection.
- Redirect URIs: `https://claude.ai/api/mcp/auth_callback` for web, Desktop,
  mobile; Claude Code uses a loopback `http://localhost:<port>/callback` (or
  `127.0.0.1`, `[::1]`) with an ephemeral port.
- PKCE S256 always. Claude sends RFC 8707 `resource` (canonical MCP URL) on
  authorize and token requests. Scopes: the `scope` in the 401 challenge, else
  protected resource metadata `scopes_supported`, else the authorization
  server's; `offline_access` is appended when the authorization server lists
  it. Refresh: proactive (5 minutes before expiry) and on `401`; expects
  `invalid_grant` for a dead refresh token; token endpoint must accept
  form-encoded bodies and answer within 10 s (refresh 30 s).
- claude.ai connectors call the MCP server from Anthropic's servers
  (`160.79.104.0/21`); Claude Code calls from the user's machine. IPv4 only.
  Only a transport-level `401` starts sign-in.

From Supabase's OAuth 2.1 server docs (overview, getting-started,
oauth-flows, mcp-authentication, token-security, signing-keys) and from
probing the production project:
- Beta, all plans, no extra charge. Currently **disabled** on the production
  project (`feature_disabled`).
- Issuer `https://qaqhdbiktzqqiuqofogz.supabase.co/auth/v1`. The OpenID
  configuration is served at `/auth/v1/.well-known/openid-configuration` and
  advertises `scopes_supported: openid profile email phone offline_access`,
  `code_challenge_methods_supported: S256 plain`,
  `token_endpoint_auth_methods_supported: client_secret_basic
  client_secret_post none`, grants `authorization_code refresh_token`. No CIMD.
- The project already signs with an asymmetric key (JWKS has one ES256 key).
- The app hosts the consent page at Site URL + "Authorization Path"; Supabase
  redirects there with `?authorization_id=`. The page calls
  `supabase.auth.oauth.getAuthorizationDetails / approveAuthorization /
  denyAuthorization` with the user's own session.
- Access tokens are ordinary Supabase JWTs: `aud: "authenticated"`,
  `role: "authenticated"`, plus `client_id` and `session_id`. No resource
  indicator support is documented; `aud` cannot be set to our resource
  without a Custom Access Token Hook. Only OIDC scopes exist; custom scopes are
  not supported. Revoking a grant deletes that client's sessions and refresh
  tokens; already-issued access tokens are not documented as invalidated.
- Dynamic registration is a dashboard toggle ("Allow Dynamic OAuth Apps").
  Redirect URIs are matched exactly.
- `splittr.cash` answers `/api/mcp` with a 308 to `www.splittr.cash`. A
  cross-host redirect drops `Authorization`, so the connector URL must be the
  `www` one.

## 3. Decisions

### O1. Supabase Auth is the authorization server; Splittr is the resource server and hosts consent

No authorization server code of our own. Splittr serves the protected
resource metadata, validates access tokens at `/api/mcp`, and hosts the
consent page. Why: the project already has it, it speaks the protocol Claude
expects, and the parts that matter for our security model (who may consent,
what is granted, revocation) live on pages and tables we control.

### O2. Registration: dynamic registration on, redirect URIs restricted at consent

Supabase has no CIMD, so Claude needs DCR (or a typed-in client ID, which is
worse UX and cannot work for Claude Code's random loopback ports with exact
matching). Open registration means anyone can create a client with any name
and redirect URI and send a Splittr user a sign-in link that asks them to
grant it access (consent phishing). Mitigation, enforced by our consent page
and by the approval endpoint behind it:
- Approval is only possible when the authorization request's `redirect_uri`
  is exactly `https://claude.ai/api/mcp/auth_callback`, or a loopback
  callback for Claude Code: `http://localhost:<port>/callback`,
  `http://127.0.0.1:<port>/callback` or `http://[::1]:<port>/callback`.
  Anything else is denied (`denyAuthorization`) and the page says this app
  is not supported.
- The page names the destination from the redirect URI we matched ("Claude"
  or "Claude Code on this computer"), never from the client's self-chosen
  name, which is shown only as quoted, secondary text.

### O3. Consent requires the same emailed code as creating a token

A grant is a long-lived credential (refresh tokens), so the D2 rule applies:
a session cookie alone must not be enough. The consent page runs the v1 flow:
pick scopes and expiry, receive the 6-digit code by email, enter it. Only then
does the server record the grant and call `approveAuthorization`. Signed-out
visitors are sent to `/signin?next=/oauth/consent?authorization_id=...`.
Denying is always one click and needs no code.

### O4. A grant is an `agent_tokens` row

On successful consent we create an `agent_tokens` row with `kind = 'oauth'`,
`oauth_client_id`, no `token_hash`, the chosen scopes and expiry, and a name
derived from the destination ("Claude" / "Claude Code"). Everything v1 built
then works unchanged for OAuth connections: scopes, rate limits, the daily
cap, audit, the circuit breaker and suspension, the profile list and revoke
buttons, revoke-all, the "Not you?" email, and proposals linked to the
granting token. One live grant per (user, client); consenting again for the
same client revokes the previous row.

### O5. Validating an OAuth access token at `/api/mcp`

A bearer value that is not a well-formed `spl_pat_` token is treated as a JWT:
1. Verify the ES256 signature against the project JWKS (cached), `iss` equal to
   the issuer, `aud` equal to `authenticated`, `exp` in the future (no leeway
   beyond 30 s).
2. Require a `client_id` claim. A first-party browser session token (no
   `client_id`) is refused: cookies and session tokens never authenticate the
   agent endpoint.
3. Look up the grant row for (`sub`, `client_id`): it must exist, be
   `kind = 'oauth'`, and not be revoked, suspended or expired. This lookup is
   what binds the token to our resource: Supabase cannot set `aud` to us, but
   only clients that went through our consent page have a grant row.
4. The resulting `Actor` is the row's user, id and scopes. Everything after is
   the v1 pipeline.
Revoking the row cuts access on the next request, even though the JWT itself
stays valid at Supabase for up to an hour.

### O6. Discovery documents and the 401 challenge

- Serve protected resource metadata at both
  `/.well-known/oauth-protected-resource/api/mcp` and
  `/.well-known/oauth-protected-resource`:
  `{ resource: "https://www.splittr.cash/api/mcp", authorization_servers:
  ["https://qaqhdbiktzqqiuqofogz.supabase.co/auth/v1"],
  bearer_methods_supported: ["header"], scopes_supported: ["email"] }`
  (values from configuration, never from the request).
- Every 401 from `/api/mcp` carries
  `WWW-Authenticate: Bearer resource_metadata="https://www.splittr.cash/.well-known/oauth-protected-resource/api/mcp", scope="email"`.
  This reverses v1's A19 decision (no metadata, to avoid a dead-end OAuth
  flow): the flow now leads somewhere.
- Supabase scopes do not carry our permissions. What an agent may do is the
  `read` / `bills:write` choice made on our consent page and stored on the
  grant. `email` is requested only because Supabase needs a scope;
  `offline_access` is appended by Claude for refresh tokens.

### O7. Revocation

From the profile page, revoking an OAuth connection revokes our row
(immediate) and also calls `supabase.auth.oauth.revokeGrant` with the user's
session so Supabase drops the refresh tokens and asks for consent next time.
Revoke-all and the "Not you?" link revoke OAuth rows too (they already revoke
all `agent_tokens` rows); the "Not you?" path has no session, so the Supabase
grant survives there until the user next signs in and revokes it, which the
page tells them.

If Supabase remembers a previous consent and skips straight to the redirect
while our row is revoked or missing, the client gets tokens that our grant
lookup refuses. The consent page must therefore always run our flow: when
`getAuthorizationDetails` reports a prior consent but no live grant row
exists, the page shows our consent step anyway and does not auto-redirect.

### O8. Switches and rollout

- New flag `MCP_OAUTH_ENABLED`, on top of `MCP_ENABLED`. With it off,
  `/api/mcp` keeps v1 behaviour (personal tokens only, no metadata, no
  challenge) and the consent page answers not-found.
- Supabase dashboard (owner does this when ready): enable the OAuth 2.1
  server; Authorization Path `/oauth/consent`; enable dynamic registration.
  Site URL is already `https://www.splittr.cash`.
- Previews keep both flags off (they share the production database).

### O9. Unused dynamically registered clients

Every fresh Claude connection registers a client. Clients with no grant row
older than 7 days are deleted with the admin API by a daily job (Vercel
cron calling an internal route with a secret, or the existing nightly
function if it can reach the admin API). Until then they are inert: no grant
row, no access.

## 4. Threats specific to v2

| # | Threat | Mitigation |
|---|---|---|
| V1 | Consent phishing with a dynamically registered client | O2 redirect allow-list, destination named from the redirect URI, O3 emailed code |
| V2 | A first-party session JWT (stolen cookie) used at `/api/mcp` | O5 step 2: `client_id` required |
| V3 | A token minted for some other client of the project | O5 step 3: grant row required for (user, client) |
| V4 | Revoked connection keeps working for up to an hour | O5 step 3 lookup on every request |
| V5 | Supabase skips consent after a prior grant | O7: page never auto-redirects without a live grant row |
| V6 | Registration spam filling `auth.oauth_clients` | O9 cleanup; Supabase's own limits; monitor |
| V7 | Token confusion between a personal token and a JWT | Prefix decides the path; a JWT is never looked up as a token hash |
| V8 | JWKS fetch fails or key rotates | Cached JWKS with refresh on unknown `kid`; fetch failure is 503, not 401 |
| V9 | Wrong URL typed (apex) | Documented; protected resource metadata names only the `www` URL |

## 5. Test plan (test-first, local)

The local stack's Supabase CLI supports `[auth.oauth_server]` in
`supabase/config.toml`, so the whole flow runs locally:
- Server tests: JWT validation (valid; wrong issuer; wrong audience; expired;
  no `client_id`; unknown `kid`; signed by another key; HS256 forged with the
  anon key; grant revoked, suspended, expired, for another client, for another
  user); metadata documents' exact contents; the 401 challenge; flag off
  behaviour; consent API (redirect allow-list, code required, re-consent
  replaces the grant, deny path, prior-consent path); revocation of OAuth rows
  by every revoke path.
- An end-to-end script that behaves like Claude: fetch metadata from the 401,
  register a client (DCR), authorize with PKCE and `resource`, sign in and
  consent in a Playwright browser (reading the code from the dev log), exchange
  the code, call `tools/list` and a tool, refresh the token, revoke on the
  profile page, and confirm the next call fails.
- After deploy: connect from Claude Code (`claude mcp add --transport http
  splittr https://www.splittr.cash/api/mcp`) and from claude.ai (custom
  connector), and run one read and one proposal end to end.

## 6. Open questions to settle by testing

- Does Supabase's authorize endpoint accept, ignore or reject the `resource`
  parameter Claude sends? (If it rejects it, v2 needs a different plan.)
- Does `getAuthorizationDetails` expose `redirect_uri` reliably, and what
  exactly does it return for a prior consent?
- With `offline_access`, does Supabase return a refresh token, and does
  refresh rotate it?
- What does the DCR registration endpoint require, and does Supabase's
  metadata advertise it once enabled (the RFC 8414 path 404s today)?
- Does a revoked Supabase grant make refresh fail with `invalid_grant`?

## 7. Revised design (after review round 1)

Round 1 read Supabase Auth's source (github.com/supabase/auth, commit
10ef1078, 2026-11-17) and found that three of the v1 assumptions were wrong.
This section is what gets built. Where it disagrees with §3, this wins.

### R-O1. OAuth access tokens never authenticate the web app

Supabase's `GET /auth/v1/user` deliberately accepts OAuth-client access
tokens ("TEMPORARY", `internal/api/api.go:284-293`), and every Splittr web
route learns who is signed in through `supabase.auth.getUser()` on the cookie
session. So a holder of a Claude access token could put it in the session
cookie and use every web route as the user: direct writes, no scopes, no
approval, no grant row.

- `src/lib/supabase/server.ts` `createClient()` returns a client whose
  `auth.getUser()` treats the session as signed out when its access token
  carries a `client_id` claim (decode the token from the cookie session; this
  is a classification, the signature is still checked by `getUser`). Every
  route already goes through `createClient()`; a test asserts that no file
  under `src/app/` creates its own server client.
- `src/proxy.ts` does the same before refreshing cookies, and also clears
  such a cookie.
- `src/app/auth/callback/route.ts` refuses to establish a session from one.
- Tests: a crafted cookie carrying an OAuth access token gets the signed-out
  answer on every cookie-authenticated route (enumerate them from the file
  system, so a new route is covered automatically).
- Pre-launch smoke test on production: `PUT /auth/v1/user`, `/logout` and
  `/factors` refuse OAuth tokens there too (production's auth version may
  differ from the source read).

### R-O2. Our consent page is the only way to approve, every time

Supabase approves a request during `GET /oauth/authorizations/{id}` (what
`getAuthorizationDetails` calls) when the user has an earlier consent for
that client covering the scopes, and then returns only `redirect_url`
(`authorize.go:228-271`). That path skips every check we add.

- Right after each successful approval, delete the user's Supabase consent
  for that client (`auth.oauth_consents`) through a `SECURITY DEFINER`
  function callable only by the service role. With no stored consent, the
  auto-approve path never runs.
- `getAuthorizationDetails` is called server-side only. If it ever returns
  the auto-approved shape (only `redirect_url`), the server does not forward
  it: it revokes that client's sessions for the user (R-O4) and the page says
  "Something went wrong, start connecting again from Claude".
- The page never auto-forwards, even when a live grant exists.

### R-O3. Who and where, shown honestly; old requests refused

- Approval is possible only when `redirect_uri` is exactly
  `https://claude.ai/api/mcp/auth_callback` (shown as "Claude (claude.ai,
  Desktop and mobile apps)", host `claude.ai`) or matches
  `^http://(localhost|127\.0\.0\.1):[1-9][0-9]{0,4}/callback$` (shown as
  "an app on this computer, such as Claude Code", with a warning that any
  program on this computer could be asking). Comparison is exact on the
  string returned by Supabase.
- Never render the client's `logo_uri` or `client_uri`. The client's name is
  shown only as quoted secondary text.
- The page and the code email both say: "Only continue if you pressed
  Connect in Claude on this device in the last few minutes. If someone sent
  you this link, stop: approving would give their Claude access to your
  Splittr."
- After every approval, email the owner "Claude was connected to your
  Splittr" with the destination, the scopes and the "Not you?" link.
- Denying a request whose `redirect_uri` is not allowed calls
  `denyAuthorization` only to close it; the browser is never sent to its
  `redirect_url` (that would be an open redirect). For an allowed URI, deny
  sends the browser to the `redirect_url` so Claude learns the outcome.
- The approval response returns `redirect_url` as JSON and the page
  navigates with `location.assign` (the CSP's `form-action 'self'` would
  block a form POST that redirects off-site). `redirect_url` is never logged
  or rendered.

### R-O4. Revocation deletes Supabase's sessions for that client

Every path that revokes an OAuth grant (profile revoke, revoke-all, the
"Not you?" link, re-consent replacing an older grant, the circuit breaker's
revoke if any) also deletes the user's `auth.sessions` rows whose
`oauth_client_id` is that client (Supabase's own `RevokeOAuthSessions` does
this, `internal/models/sessions.go:379`), through a service-role-only
`SECURITY DEFINER` function, and deletes the stored consent. The "Not you?"
link and revoke-all do it for all of the user's OAuth clients. Before an
approval, the same function runs for (user, client), so refresh tokens from
an earlier grant can never come back to life under a new row.

### R-O5. Step-up at consent, bound to this request

Proof of inbox control is required, by either:
- a magic-link sign-in completed in the last 10 minutes (the session's `amr`
  entry for `otp` with its timestamp; verify by test that a refreshed
  session keeps the original sign-in time, otherwise drop this option), or
- the emailed 6-digit code, from a separate pending record:
  `agent_oauth_pending` keyed by user, holding `authorization_id`,
  `client_id`, the destination, the chosen scopes and expiry; the code's
  HMAC input is `userId:oauth:authorizationId:code`, so a code issued for one
  request (or for a personal token) can never approve another. Wrong codes
  count toward the same 24-hour mint lock as personal tokens.

The grant is created by a SQL function `grant_oauth_agent(...)` under the
existing per-user advisory lock, which also enforces the caps (R-O6). The
server then calls `approveAuthorization` with the user's session; if that
fails, the new grant row is revoked.

### R-O6. Grant rows

New migration `019_agent_oauth.sql` (applied only when turning OAuth on):
- `agent_tokens.kind` (`'pat' | 'oauth'`, default `'pat'`),
  `oauth_client_id uuid`, `oauth_destination text`, `token_hash` and `last4`
  nullable, and
  `CHECK ((kind = 'pat' AND token_hash IS NOT NULL AND oauth_client_id IS NULL) OR (kind = 'oauth' AND token_hash IS NULL AND oauth_client_id IS NOT NULL))`.
- Partial unique index on `(user_id, oauth_client_id) WHERE kind = 'oauth' AND revoked_at IS NULL`.
- Separate caps: 5 active personal tokens (unchanged, counted over
  `kind = 'pat'` only) and 5 active OAuth grants.
- Claude registers a new client on every fresh connection, so "one per
  client" would not dedupe anything. Instead, a new consent replaces older
  live OAuth grants with the same destination class (`claude.ai` or
  `loopback`): they are revoked (R-O4) and their pending proposals deleted,
  and the consent page says so before the user confirms ("This replaces your
  existing Claude connection").
- OAuth grants expire after 90 days (fixed at consent); Claude then has to
  sign in again.
- The profile list shows OAuth grants as connections (destination, scopes,
  connected, last used), never with `last4`.

### R-O7. Validating the access token

A bearer value that is a well-formed `spl_pat_` token follows the v1 path.
Anything else is a JWT, validated with `jose`:
- keys from the project JWKS through `createRemoteJWKSet` (pick by `kid`,
  `kid` required, refresh on unknown `kid` at most once a minute, cache at
  most 10 minutes); `algorithms: ['ES256', 'RS256']`; the header's `jku`,
  `jwk` and `x5u` are never used;
- `iss` equal to the configured issuer, `aud === 'authenticated'` exactly,
  `role === 'authenticated'`, `exp` with at most 30 s tolerance, `sub`,
  `session_id` present, `client_id` present and a UUID;
- then the live grant row for (`sub`, `client_id`, kind `oauth`);
- never `getUser()` / `getClaims()` for this (no audience check, and they
  accept the legacy HS256 key).
- Invariant, written in the code and the docs: `client_id` is trustworthy only
  while the project has no Custom Access Token Hook, and the grant row is our
  audience binding only while splittr.cash is the only consumer of this OAuth
  server. Any future OAuth app must never be able to pass `/oauth/consent`.

### R-O8. Status codes and the challenge

- 401 with `WWW-Authenticate: Bearer resource_metadata="<www>/.well-known/oauth-protected-resource/api/mcp", scope="email"`
  for: no credential, an invalid, expired or unknown JWT, and a revoked or
  expired OAuth grant. Claude refreshes or signs in again.
- A well-formed `spl_pat_` that fails gets the v1 401 without
  `resource_metadata`, so personal-token clients are not pushed into an OAuth
  flow they cannot finish.
- A suspended grant gets 403 with the reason (a 401 would make Claude sign in
  again and the breaker would mean nothing).
- JWKS unreachable: 503.
- The failed-auth counter (per IP, in memory) counts only failing `spl_pat_`
  values; never a missing credential or a JWT failure (all claude.ai traffic
  shares Anthropic's addresses, and only a 401 starts sign-in or refresh).

### R-O9. Discovery

As §3 O6, plus: `/.well-known/*` is excluded from the proxy matcher;
`scopes_supported: ["email"]` (Claude appends `offline_access`); documents
built from configuration only.

### R-O10. Deferred, monitored

- No cleanup job for dynamically registered clients (Supabase deletes clients
  softly, so it would not shrink the table, and the job would hold the
  service role). Monitor `auth.oauth_clients` instead.
- Supabase limits dynamic registration to about 10 per 5 minutes per IP;
  claude.ai registrations all come from Anthropic's addresses. Monitor.
- Cursor, VS Code and other clients whose redirect URIs are not on the
  allow-list stay on personal tokens.

### R-O11. Tests

- Local stack signs with ES256 like production: add a local
  `supabase/signing_keys.json` (generated, never a production key) and point
  `config.toml` at it; enable `[auth.oauth_server]` with
  `authorization_url_path = "/oauth/consent"` and dynamic registration.
- Server tests for R-O1 to R-O8, including: `alg: none`; a missing `kid`; a
  `jku` header; an HS256 token signed with the local JWT secret; an ID token;
  a JWT in the query string; a first-party session JWT; a token for a client
  with no grant; a Claude Code reconnect on a new port; a personal-token
  client receiving no challenge; two concurrent consents; re-consent
  replacing an older grant; the auto-approve shape; deny with a disallowed
  redirect never forwarding.
- An end-to-end script that behaves like Claude against the local stack:
  read the 401 challenge and metadata, register (DCR), authorize with PKCE
  and `resource`, sign in and consent in Playwright, exchange the code,
  `tools/list` and a tool call, refresh, revoke on the profile page, and
  confirm the next call and the next refresh both fail.
- Pre-launch smoke test on production with a test account (after the
  dashboard switch, before the flag): RFC 8414 document carries
  `registration_endpoint`; DCR and `/oauth/token` work without an `apikey`
  header; the auto-approve response shape; the refresh error shape after
  revocation (Supabase answers `refresh_token_not_found` /
  `session_not_found`, not RFC `invalid_grant`); OAuth tokens refused by
  `PUT /user`, `/logout`.
- After deploy: connect from Claude Code and from claude.ai; and test the
  phishing case in §8 D3 (start a connection in claude.ai account A, finish
  consent in a browser signed in to a different claude.ai account or none)
  and record what Claude does.

## 8. Review log

Round 1 (separate reviewer, Opus, read Supabase Auth's source and the
primary docs):

| Finding | Severity | Resolution |
|---|---|---|
| D1 OAuth tokens accepted by every web route through `getUser()` | Critical | R-O1 |
| D2 prior consent auto-approved during GET, only `redirect_url` returned | High | R-O2 |
| D3 phishing that binds the victim's Splittr to the attacker's Claude | High (needs a test) | R-O3 warnings and notification email; tested after deploy |
| D4 revoked grants' sessions revive under a new row | High | R-O4 |
| D5 failed-auth limiter shared by all claude.ai users | Medium | R-O8 |
| D6 several grant rows break the lookup | Medium | R-O6 unique index, live filter, SQL function |
| D7 per-client dedupe does nothing with DCR; caps shared with personal tokens | Medium | R-O6 destination classes, separate caps |
| D8 suspended grant answered 401 restarts sign-in | Medium | R-O8 403 |
| D9 deny becomes an open redirect | Medium | R-O3 |
| D10 dead refresh token is not `invalid_grant` | Medium | R-O11 test with Claude; report to Supabase |
| D11 emailed code not bound to the request | Medium | R-O5 |
| D12 validation details (`kid`, algorithms, headers, claims) | Medium | R-O7 |
| D13 local stack signs HS256; no production smoke test | Medium | R-O11 |
| D14 audience binding is an invariant, not enforced by Supabase | Low | R-O7 invariant |
| D15 `token_hash` / `last4` NOT NULL; kind confusion | Low | R-O6 check constraint |
| D16 personal-token clients pushed into OAuth | Low | R-O8 |
| D17 CSP blocks a redirecting form POST | Low | R-O3 JSON + `location.assign` |
| D18 attacker-controlled branding, loopback wording | Low | R-O3 |
| D19 client cleanup job weaker than stated | Low | R-O10 deferred |
| D20 registration rate limit, two emails in 10 minutes, apex cookies, trailing slash | Low | R-O5 fresh-sign-in option; R-O10 monitor; R-O9 |

Answers established from the source: `resource` is accepted and stored but
never affects `aud`; `getAuthorizationDetails` returns `redirect_uri`,
`client`, `user` and `scope` on a fresh request; a refresh token is issued on
every code exchange and rotates; dynamic registration is
`POST {issuer}/oauth/clients/register`, advertised in RFC 8414 metadata only
when enabled; access tokens also carry a `scope` claim.
