# Spec: OAuth sign-in for the Splittr MCP server (v2)

Status: v3.1. Part 2 (§10 onward) replaces the Supabase-based design in §3
and §7, which are kept for the record. Build from Part 2 as amended by §13
(where §13 and §12 differ, §13 wins); §14 has the API contracts.
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

## 9. Spike results (WP8)

Run 2026-11-20/21 with `scripts/oauth-probe.mjs` against the local stack
(Supabase CLI 2.122.0, `[auth.oauth_server]` enabled, dynamic registration on,
ES256 key from `supabase/signing_keys.json`, `refresh_token_reuse_interval = 10`).
Everything below is the local GoTrue version. Production may be older or newer;
the pre-launch smoke test in R-O11 still has to repeat the items marked
"verify on production". Raw output is reproducible: `node scripts/oauth-probe.mjs`.

### Contradictions with section 7, up front

1. **R-O1 is necessary but not sufficient: OAuth access tokens can write to the
   user's account at Supabase directly.** With an access token from the OAuth
   flow (scope `email offline_access`), the local GoTrue answered:
   `GET /auth/v1/user` 200; `PUT /auth/v1/user` 200 for `user_metadata` (the
   write went through); **`PUT /auth/v1/user {password}` 200, and signing in
   with that password then worked** (an account-takeover path that outlives
   revocation of the grant); `PUT /auth/v1/user {email}` reached the
   email-change code (500 only because the local stack has no mail server);
   `POST /auth/v1/logout?scope=local` 204 (ends that OAuth session);
   **`POST /auth/v1/logout` (default scope global) 204 and then the user's own
   browser session answered 403**, so a Claude token can sign the user out
   everywhere. `POST /factors` answered 422 `mfa_totp_enroll_not_enabled` only
   because local MFA enrollment is off. Setting `secure_password_change = true`
   locally did not change the password result (not confirmed that the setting
   reached GoTrue, and a just-created session may pass its recency rule
   anyway). The pre-launch smoke test line in R-O1 ("refuse OAuth tokens there
   too") is therefore expected to FAIL; it must be run on production, and the
   design needs a decision: accept (the token is the user's own delegated
   credential, scope `email` only limits OIDC claims), or find a Supabase-side
   control (custom access token hook cannot remove capabilities; Auth hooks
   or disabling the password provider are the candidates), or report to
   Supabase. Direct data access is NOT possible: PostgREST answered 403
   `42501` (no privilege) for `profiles`, `bills`, `participants`,
   `agent_tokens`, `groups` with the OAuth token, same as for any
   authenticated session under migrations 006/012/014.
2. **The RFC 8414 path-insertion URL does not exist locally.**
   `/.well-known/oauth-authorization-server/auth/v1` is 404 (Kong has no route
   for it; the same for `/.well-known/openid-configuration/auth/v1` and the
   origin-root openid-configuration). The documents are served only under the
   issuer: `/auth/v1/.well-known/oauth-authorization-server` and
   `/auth/v1/.well-known/openid-configuration` (identical, 200). Claude
   falls back to the latter (section 2 says so), so this works, but nothing
   at the origin root helps. Verify on production (Supabase's hosted gateway
   may route more).
3. **Refresh failure is not `invalid_grant`, confirming D10.** After the
   client's sessions are deleted (or `revokeGrant` is called) a refresh answers
   HTTP 400 `{"code":400,"error_code":"refresh_token_not_found","msg":"Invalid
   Refresh Token: Refresh Token Not Found"}` (GoTrue shape, not the RFC
   `{"error":"invalid_grant"}` shape). Authorization-code failures DO use the
   RFC shape (replayed code: 400 `{"error":"invalid_grant","error_description":
   "Invalid authorization code"}`). A reused-too-old refresh token answers
   400 `refresh_token_already_used`.
4. **An already-issued access token stops working at Supabase the moment its
   session is deleted** (`GET /user` -> 403 `session_not_found`), but section
   7's R-O7 validates the JWT locally, which keeps accepting it until `exp`
   (up to an hour). R-O7 relies on the grant row for revocation, which covers
   this; but note the two disagree, and the grant row, not `getUser`, must stay
   the authority.

Everything else below agrees with section 7 and section 8's "answers
established from the source".

### Step answers

**1. Discovery.** RFC 8414 under the issuer: `registration_endpoint`
`<issuer>/oauth/clients/register`; `scopes_supported`
`openid profile email phone offline_access`; `code_challenge_methods_supported`
`S256 plain`; `token_endpoint_auth_methods_supported`
`client_secret_basic client_secret_post none`; `grant_types_supported`
`authorization_code refresh_token`;
`client_id_metadata_document_supported` absent (no CIMD, so Claude uses DCR).
The OpenID configuration is identical. See contradiction 2 for the paths.

**2. DCR.** `POST <issuer>/oauth/clients/register`, JSON body, works **with and
without an `apikey` header** (201 both ways; verify on production, where the
hosted gateway may differ). Response: `client_id` (uuid), `client_type:
"public"`, `redirect_uris`, `token_endpoint_auth_method: "none"`, `grant_types`,
`response_types`, `client_name`, `registration_type: "dynamic"`, timestamps. No
secret for a public client. Both the `https://claude.ai/api/mcp/auth_callback`
and the loopback `http://localhost:53123/callback` registrations succeed. A
plain-http non-loopback redirect is refused at registration (400
`validation_failed`, "HTTP scheme only allowed for localhost"), which is a free
extra layer under O2.

**3. Authorize with `resource`.** `GET <issuer>/oauth/authorize?response_type=code
&client_id&redirect_uri&code_challenge&code_challenge_method=S256&state
&scope=email+offline_access&resource=https://www.splittr.cash/api/mcp` (no
`apikey`, as in a browser) -> 302 to
`http://localhost:3199/oauth/consent?authorization_id=<32 chars>`. The
`resource` parameter is **accepted** and stored (`auth.oauth_authorizations.
resource` holds it); omitting it also works; a non-absolute-URI resource
(`not a url`) is refused by redirecting to the client's `redirect_uri` with
`error=invalid_request&error_description=resource must be an absolute URI`.
An unregistered `redirect_uri` is 400 `validation_failed "invalid
redirect_uri"` (no redirect). Authorizations expire after 3 minutes
(`expires_at` default `now() + 3 minutes`).

**4. Details and approve.** `GET <issuer>/oauth/authorizations/{authorization_id}`
with headers `apikey: <anon>` and `Authorization: Bearer <user access token>`.
Fresh request response (200):
`{"authorization_id","redirect_uri":"https://claude.ai/api/mcp/auth_callback",
"client":{"id","name"},"user":{"id","email"},"scope":"email offline_access"}`.
`redirect_uri` IS exposed reliably (it is not in supabase-js's TypeScript type;
read it from the raw response). Without a user JWT: 401 `no_authorization`.
Another user fetching the same authorization: 404 `oauth_authorization_not_found`
(the request is bound to the first user who reads it, even before approval).
Approve: `POST .../oauth/authorizations/{id}/consent` body `{"action":"approve"}`
-> 200 `{"redirect_url":"<redirect_uri>?code=<uuid>&state=<state>"}`.

**5. Token exchange.** `POST <issuer>/oauth/token`, form body, **no `apikey`
header** -> 200 `{access_token, expires_in: 3600, refresh_token, token_type:
"bearer"}` (a 12-character opaque refresh token; no `scope`, no `id_token`
because `openid` was not requested). Access token header
`{"alg":"ES256","kid":"<the local key's kid>","typ":"JWT"}`; payload keys
`iss` (`<issuer>`), `sub`, `aud: "authenticated"`, `exp`, `iat`, `email`,
`phone`, `app_metadata`, `user_metadata`, `role: "authenticated"`,
`aal: "aal1"`, `amr: [{"method":"oauth_provider/authorization_code",
"timestamp":...}]`, `session_id`, `is_anonymous`, `client_id`, `scope: "email
offline_access"`. `resource` has no effect on `aud`. Replaying the code: 400
`invalid_grant`. A refreshed access token keeps the same `client_id`, `scope` and the original
`amr` timestamp.

**6. Auto-approve.** Second authorization for the same client and user, then
`getAuthorizationDetails` -> 200 with ONLY
`{"redirect_url":"<redirect_uri>?code=...&state=..."}` (no `authorization_id`,
`client`, `user`, `scope`), and that code exchanges for working tokens
including a refresh token. The consent is stored in `auth.oauth_consents
(id, user_id, client_id, scopes, granted_at, revoked_at)`, unique on
`(user_id, client_id)`. After `delete from auth.oauth_consents where user_id=$1
and client_id=$2` the next authorization returns the full details again. A
request for MORE scopes than the stored consent (adds `profile`) also returns
full details (consent is requested again); an equal request is auto-approved (a narrower one was not tested).

**7. Refresh.** Refresh: `POST <issuer>/oauth/token` form
`grant_type=refresh_token&refresh_token=...&client_id=...` -> 200 with a new
access token and a NEW refresh token (rotation). Presenting the previous
(parent) token again right away returns 200 with the same successor token, not
a new one (the reuse interval; 10 s locally), and also while the child had not
yet been used; after the child is used and the interval has passed, the
two-generations-old token answers 400 `refresh_token_already_used` and the
newest token KEEPS working (no family revocation observed). After deleting the
client's rows in `auth.sessions` (`where user_id=$1 and oauth_client_id=$2`;
column is `oauth_client_id`): refresh 400 `refresh_token_not_found` (contradiction
3). Real revoke, `DELETE <issuer>/user/oauth/grants?client_id=<id>` with the
user's own session (204): sets `revoked_at` on the consent row (soft), deletes
all of that client's sessions for the user (0 left), refresh then answers 400
`refresh_token_not_found`, the access token answers 403 `session_not_found` at
`/user`, and the next authorization asks for consent again.
`GET <issuer>/user/oauth/grants` lists live grants
(`[{client:{id,name}, scopes, granted_at}]`). `DELETE .../grants` for a client
with no consent row answers 404.

**8. User endpoints with an OAuth token.** See contradiction 1. All of
`GET /user`, `PUT /user`, `POST /logout` accept it, plus
`GET /oauth/userinfo` (200 `{email, email_verified, sub}`). After a password
change through the OAuth token the user's other sessions died (403) but the
OAuth session lived on.

**9. Deny.** `POST .../consent {"action":"deny"}` -> 200 `{"redirect_url":
"<redirect_uri>?error=access_denied&error_description=User+denied+the+request
&state=..."}` (same for claude.ai and loopback redirect). The authorization is
then closed: approving it afterwards is 400 `validation_failed "authorization
request is no longer pending"`. Another user approving someone's authorization:
404.

**10. Session freshness (R-O5 option 1).** `verifyOtp` with `type: 'magiclink'`
and with `type: 'email'` (both fed the hashed token from
`admin.generateLink({type:'magiclink'})`) give the identical
`amr: [{"method":"otp","timestamp":<sign-in time>}]`, `aal1`. After
`refreshSession()` 5 s later the new access token has a later `iat` but the
**same** `amr` entry and timestamp (`auth.mfa_amr_claims` keeps its original
`created_at`). So "the `otp` timestamp within the last 10 minutes" is a
sound freshness check and survives refresh; the option stays. Caveats: it
proves a magic-link (or emailed OTP) sign-in, not that the person is at the
keyboard now; and `amr` entries are `otp`-only for magic-link sessions: a
session created any other way (password, OAuth) has a different method, which
the check must reject. An OAuth session's `amr` is
`oauth_provider/authorization_code`, never `otp`, so an OAuth token can never
satisfy this check.

### Other facts worth keeping

- The local access tokens for the stack's own `anon` and `service_role` keys are
  ES256 JWTs once `signing_keys_path` is set (the CLI re-signs them); all 377
  server tests passed unchanged.
- `auth.oauth_clients` held 21 rows after the probe runs: registrations
  accumulate (R-O10).


# Part 2: Splittr issues its own tokens (v3)

## 10. Why the Supabase-based design was dropped

The WP8 spike (§9) showed that an access token issued by Supabase's OAuth
server to Claude is a full account credential at Supabase itself: with it,
`PUT /auth/v1/user` set a password on a magic-link-only account (then usable to
sign in, surviving revocation of the grant), started an email change, and
`POST /auth/v1/logout` signed the user out everywhere. Production runs Supabase
Auth v2.198.0, one minor version above the v2.197.0 tested locally. Our own
code (R-O1) can stop such a token at Splittr's routes, but not at Supabase's,
and every future Supabase endpoint would be a new place to check. Supabase's
OAuth server is also in beta, cannot bind a token to our resource, re-approves
silently, and answers dead refresh tokens outside RFC 6749.

So Splittr becomes its own small authorization server for exactly one
resource (`/api/mcp`) and exactly two clients (Claude and Claude Code). Its
tokens are random strings stored hashed, like personal tokens: they work at
`/api/mcp` and nowhere else, and they die the moment the grant is revoked.
Supabase's OAuth server stays **disabled** in production. Users still sign in
to Splittr with the magic link; that session is only used on our consent page.

R-O1 (OAuth tokens never authenticate the web app) stays as defence in depth.

## 11. Facts Part 2 relies on (checked 2026-11-20)

- Claude's client identity documents (fetched):
  - `https://claude.ai/oauth/mcp-oauth-client-metadata`: `client_name`
    "Claude", `redirect_uris` `["https://claude.ai/api/mcp/auth_callback"]`,
    `grant_types` `authorization_code, refresh_token,
    urn:ietf:params:oauth:grant-type:jwt-bearer`, `response_types` `code`,
    `token_endpoint_auth_method` `none`. Used by claude.ai web, Desktop,
    mobile and Cowork.
  - `https://claude.ai/oauth/claude-code-client-metadata`: `client_name`
    "Claude Code", `redirect_uris` `["http://localhost/callback",
    "http://127.0.0.1/callback"]`, `grant_types` `authorization_code,
    refresh_token`, `token_endpoint_auth_method` `none`.
- Claude chooses CIMD when the authorization server metadata has
  `client_id_metadata_document_supported: true` and `none` in
  `token_endpoint_auth_methods_supported`; it needs
  `code_challenge_methods_supported: ["S256"]`; it appends `offline_access`
  when the authorization server lists it; it sends `resource` (canonical MCP
  URL) on authorize and token requests, PKCE S256 always, form-encoded token
  requests; it refreshes proactively (5 minutes before expiry) and on 401,
  expects `invalid_grant` for a dead refresh token, and gives the token
  endpoint 10 s (30 s for refresh). It caches discovery for about 5 minutes.
- Claude's docs ask the server to match `http://localhost`,
  `http://127.0.0.1` and `http://[::1]` redirect URIs with the port ignored
  (Claude Code uses an ephemeral port), and `https://claude.ai/api/mcp/auth_callback`
  exactly.
- The CIMD draft (draft-ietf-oauth-client-id-metadata-document-03) and the
  MCP spec (2025-11-25): fetch with `Accept: application/json`, 200 only, no
  redirects, at most 5 KB, the document's `client_id` must equal the URL
  exactly (no normalisation), validate `redirect_uris`, never redirect the
  user agent after a failed client check, include `iss` in the authorization
  response (RFC 9207), public clients must rotate refresh tokens, persisted
  consent is scoped to (client_id, resource), the consent screen must show the
  redirect URI's hostname and warn for localhost-only clients.

## 12. Decisions

### S1. Roles and URLs

- Issuer: `https://www.splittr.cash` (no path, so RFC 8414 metadata is at
  `/.well-known/oauth-authorization-server`).
- Protected resource: `https://www.splittr.cash/api/mcp`.
- Endpoints: authorization `https://www.splittr.cash/oauth/authorize` (a page),
  token `https://www.splittr.cash/api/oauth/token`. No registration endpoint,
  no revocation endpoint, no OpenID Connect.
- All values come from configuration (`CANONICAL_ORIGIN`), never from the
  request. `/.well-known/*` and `/api/oauth/*` are excluded from the proxy
  matcher (no cookies read or set there); `/oauth/authorize` is a normal page
  and needs the session.

### S2. Exactly two clients, by exact `client_id`

- `client_id` must be exactly one of the two URLs in §11. Anything else
  (another URL, a non-URL, a different scheme, case, port, trailing slash or
  query) is refused at the authorization endpoint with our own error page and
  never redirects; at the token endpoint it is `invalid_client`.
- The server fetches that one document (and only those two URLs ever):
  HTTPS, `Accept: application/json`, no redirects, 5 s timeout, 5 KB cap, 200
  only, JSON with `client_id` equal to the URL exactly, `redirect_uris` a
  non-empty array of strings, `token_endpoint_auth_method` absent or `none`,
  `grant_types` including `authorization_code`. Cached in memory for at most
  24 hours (shorter if `Cache-Control` says so), errors never cached. If a
  fetch fails and there is no cached copy, the request fails with "Claude's
  sign-in is temporarily unavailable" (authorize) or 503 (token); a transient
  failure never invalidates existing grants.
- Redirect URI matching uses the fetched `redirect_uris`: exact string match,
  except that a registered `http://localhost/<path>`,
  `http://127.0.0.1/<path>` or `http://[::1]/<path>` also matches the same
  host and path with any port 1–65535. No other normalisation.
- Destination shown to the person, derived from the matched redirect URI's
  host (never from `client_name`): `claude.ai` for the hosted apps, "an app on
  this computer, such as Claude Code" for loopback, with the extra warning the
  MCP spec asks for.

### S3. Scopes are ours

- Scopes: `read` and `bills:write`, plus `offline_access` accepted and
  ignored (every grant gets a refresh token).
- Protected resource metadata `scopes_supported: ["read", "bills:write"]`;
  authorization server metadata `scopes_supported: ["read", "bills:write",
  "offline_access"]`; the 401 challenge carries `scope="read bills:write"` so
  Claude asks for both and the person chooses on the consent page.
- The person grants `read` (always) and `bills:write` (opt-in checkbox,
  unchecked by default) whatever was requested; unknown requested scopes are
  ignored. The token response's `scope` is the granted set (RFC 6749 allows
  narrower).

### S4. The authorization request

`GET /oauth/authorize` validates, in this order, and on any failure before
step 3 shows our error page without redirecting:
1. feature switch (`MCP_OAUTH_ENABLED`, on top of `MCP_ENABLED` and the
   pepper): off is a not-found page;
2. `client_id` (S2) and its document;
3. `redirect_uri` against the document (S2);
after which errors redirect to the client with `error`, `error_description`,
`state` and `iss`:
4. `response_type=code`;
5. `code_challenge` present, 43–128 characters of the PKCE alphabet, and
   `code_challenge_method=S256` (`plain` refused);
6. `resource`, if present, equal to `https://www.splittr.cash/api/mcp` after
   canonicalising scheme and host case, default port and a trailing slash
   (`invalid_target` otherwise); if absent, it is that value;
7. `state` kept verbatim (up to 512 characters).
The request is stored server-side (`agent_oauth_requests`, 10 minutes, all of
the above) and the browser is sent to `/oauth/consent/<request id>`. The
request id is 128 random bits. The first signed-in Splittr user to open it
owns it; anyone else gets not-found. Signed-out visitors go to
`/signin?next=/oauth/consent/<id>`.

### S5. Consent

The consent page shows the destination (S2), the hostname, what the agent
will be able to do, the expiry (90 days), the phishing warning ("Only continue
if you pressed Connect in Claude on this device in the last few minutes. If
someone sent you this link, stop: approving would give their Claude access to
your Splittr."), and, when one exists, "This replaces your existing <Claude /
Claude Code> connection from <date>". The client's own name and URI are never
rendered as trusted text; there is no logo.

Approval needs proof of inbox control: either a magic-link sign-in within
the last 10 minutes (the session token's `amr` `otp` timestamp; the spike
showed it survives refresh and that a non-OTP session never carries it), or
the emailed 6-digit code. The code is bound to the request: HMAC input
`userId:oauth:<request id>:code`, 5 attempts per code, 3 code emails per user
per hour, and wrong codes count toward the same 24-hour mint lock as personal
tokens. The email names the destination and the scopes and repeats the
phishing warning.

Approve (POST, same-site Origin, session, step-up) runs one SQL function under
the per-user advisory lock that: re-checks the request is pending, unexpired
and owned by the caller; revokes any live grant of this user for the same
`client_id` (its tokens die with it, its unapproved proposals are deleted);
creates the grant (`agent_tokens`, `kind = 'oauth'`); creates the
authorization code; marks the request approved. Caps: 5 live OAuth grants per
user, separate from the 5 personal tokens. The response is JSON with the
redirect URL (`redirect_uri?code=…&state=…&iss=https%3A%2F%2Fwww.splittr.cash`)
and the page navigates with `location.assign`. Then the "Claude was
connected" email goes out, with the destination, the scopes and the "Not
you?" link.

Deny (POST, same-site Origin, session) marks the request denied and redirects
to `redirect_uri?error=access_denied&state=…&iss=…`. Nothing is stored about a
denial beyond the request row.

No consent is remembered: every authorization shows the consent page.

### S6. Codes and tokens

- Authorization code: 256 random bits, stored as SHA-256, single use, 5
  minutes, bound to the grant, `client_id`, `redirect_uri`, `code_challenge`
  and resource. A second use of a code revokes the grant it created (RFC 9700).
- Access token: `spl_oat_` + 256 random bits, stored as SHA-256, 1 hour.
- Refresh token: `spl_ort_` + 256 random bits, stored as SHA-256, rotated on
  every use, valid while the grant lives (grant expiry 90 days). Reusing a
  rotated refresh token revokes the grant (and with it every token), except
  within 30 seconds of its rotation when its successor has not been used yet,
  in which case the same successor pair is returned again (Claude can refresh
  concurrently; this mirrors Supabase's reuse interval). All of it in one SQL
  function under a row lock.
- Token endpoint `POST /api/oauth/token`: form-encoded only (JSON is
  `invalid_request`), `client_id` required in the body and equal to the code's
  or grant's, no client authentication accepted (`invalid_client` if an
  `Authorization` header or `client_secret` is sent), `resource` if present
  must match. `grant_type=authorization_code` checks `code`, `redirect_uri`
  (exact, as sent at authorization) and `code_verifier` (S256, constant-time
  compare); `grant_type=refresh_token` rotates. Errors in RFC 6749 shape
  (`invalid_request`, `invalid_client`, `invalid_grant`,
  `unsupported_grant_type`, `invalid_target`) with 400 (401 for
  `invalid_client`), `Cache-Control: no-store`. A revoked or expired grant's
  refresh is `invalid_grant`. A suspended grant still refreshes, so Claude
  does not start a new sign-in that would bypass the circuit breaker; its
  tokens are refused at `/api/mcp` with 403 (S7) until the owner resumes it.
- Rate limits on the token endpoint: per grant (60 a minute) and per code;
  per IP only for requests that fail before a grant is identified, in memory.

### S7. At `/api/mcp`

- `spl_pat_…`: v1 path, unchanged, and its failures get the v1 401 without
  `resource_metadata` (personal-token clients are not pushed into OAuth).
- `spl_oat_…`: look up by hash; it must be unexpired and its grant live
  (not revoked, not expired). The grant row becomes the `Actor`, and the whole
  v1 pipeline (scopes, rate limits, daily cap, audit, breaker, proposals,
  output rules) applies unchanged.
- No credential, or a failing `spl_oat_` / unknown value: 401 with
  `WWW-Authenticate: Bearer resource_metadata="https://www.splittr.cash/.well-known/oauth-protected-resource/api/mcp", scope="read bills:write"`
  and, for a token that was presented, `error="invalid_token"`.
- A suspended OAuth grant: 403 with the reason (a 401 would restart sign-in).
- The failed-auth counter counts only failing `spl_pat_` values.

### S8. Grants and revocation

Migration `019_agent_oauth.sql` (applied when turning OAuth on; safe before):
`agent_tokens.kind` (`pat`/`oauth`, default `pat`), `oauth_client_id`
(text), `oauth_destination` (`claude.ai`/`loopback`), `token_hash` and `last4`
nullable with a CHECK tying them to `kind`; a partial unique index on
`(user_id, oauth_client_id)` for live OAuth grants; separate caps; new tables
`agent_oauth_requests`, `agent_oauth_codes`, `agent_oauth_tokens`, all with
RLS on and every grant to the public roles revoked, functions
`SECURITY DEFINER`, `search_path = ''`, EXECUTE for `service_role` only;
`prune_agent_access()` extended to delete expired requests, codes and
tokens.
Every existing revoke path (profile revoke, revoke-all, the "Not you?" link,
query-string leak, circuit breaker suspension) already acts on `agent_tokens`
rows, so OAuth grants are covered; revoking also deletes the grant's
`agent_oauth_tokens` rows. The profile list shows OAuth grants as
connections (destination, scopes, connected, last used), never `last4`.

### S9. Discovery documents

- `/.well-known/oauth-protected-resource/api/mcp` and
  `/.well-known/oauth-protected-resource`:
  `{ "resource": "https://www.splittr.cash/api/mcp", "authorization_servers":
  ["https://www.splittr.cash"], "bearer_methods_supported": ["header"],
  "scopes_supported": ["read", "bills:write"], "resource_name": "Splittr" }`.
- `/.well-known/oauth-authorization-server`: `issuer`,
  `authorization_endpoint`, `token_endpoint`, `response_types_supported:
  ["code"]`, `grant_types_supported: ["authorization_code", "refresh_token"]`,
  `token_endpoint_auth_methods_supported: ["none"]`,
  `code_challenge_methods_supported: ["S256"]`,
  `client_id_metadata_document_supported: true`, `scopes_supported` (S3),
  `authorization_response_iss_parameter_supported: true`.
- Served only when `MCP_OAUTH_ENABLED`; JSON, `Cache-Control: max-age=300`.

### S10. Unchanged from v1 and from §7

The R-O1 guard; the v1 output rules, guardrails and approval flow for
proposed bills; the D3 phishing case remains a residual risk to be tested
after deploy (start a connection in one claude.ai account, finish consent in
a browser signed in to another or none).

### S11. Tests

Test-first, local, with a stub for the two document fetches (tests never
reach claude.ai), plus:
- every validation step of S4 (each failure, and which ones must not
  redirect);
- consent: ownership by first viewer, signed-out redirect, step-up both ways,
  code bound to the request, replacement of the previous grant for the same
  client, caps, deny, expired request;
- codes: single use, reuse revokes the grant, expiry, every binding (client,
  redirect, verifier, resource);
- refresh: rotation, reuse outside the grace window revokes, concurrent
  refresh inside it returns the same pair, revoked grant gives
  `invalid_grant`, suspended grant still refreshes;
- `/api/mcp` with OAuth tokens through the whole v1 matrix, the 401 challenge
  shape, PAT failures without challenge, suspended 403;
- every revoke path kills OAuth access immediately;
- discovery documents' exact contents; flags off;
- an end-to-end script that behaves like Claude against a local server and
  fetches the real Claude documents from claude.ai once (read-only), to prove
  the fetcher accepts them;
- after deploy: connect from Claude Code here and from claude.ai, run a read
  and a proposal, revoke, and the D3 test.

### S12. What the owner does at launch

Nothing in the Supabase dashboard. In Vercel Production only:
`MCP_OAUTH_ENABLED=true` (with `MCP_ENABLED=true` and the pepper already set),
after migrations 017–019 are applied. Supabase's OAuth server stays off.

## 13. Amendments after review (Part 2, round 1)

A separate reviewer (Opus) attacked §10–§12 against Claude's docs, the
published client documents, the MCP spec, the CIMD draft and RFCs 6749,
7636, 8252, 8414, 8707, 9207, 9700 and 9728. It found no way to obtain tokens
without approval on the consent page and expects Claude to complete the
flow, but found problems that would have broken connections or weakened the
design. Each item below amends §12.

**A1 (E1) Refresh rotation without storing plaintext.** Successor tokens are
derived, not random: for a refresh token `RT`, the next access token is
`spl_oat_` + base64url(HMAC-SHA256(k, "at|" + RT)) and the next refresh token
`spl_ort_` + base64url(HMAC-SHA256(k, "rt|" + RT)), with `k` derived from
`AGENT_TOKEN_PEPPER` (HMAC(pepper, "oauth-token-derivation")). A replay of `RT`
within 120 s of its rotation, while its successor is unused, recomputes and
returns the same pair, so Claude's retries and concurrent refreshes are safe
and the family never forks. A replay outside that window, or after the
successor was used, revokes the grant, writes an audit row and emails the
owner. The first tokens issued at code exchange are random.

**A2 (E2) Signing in without leaving the auth browser.** The magic-link email
gains the 6-digit code (`{{ .Token }}`) next to the link; the template in
`supabase/email-templates/magic-link.html` is updated and the owner pastes it
into the Supabase dashboard (owner action). `/signin` offers "enter the code
from the email" (`verifyOtp({ type: 'email', email, token })`), always, and
leads with it when `next` is a consent page, so a person connecting from
Desktop or mobile signs in inside the same browser sheet Claude opened.

**A3 (E3) A database error is never `invalid_grant`.** At the token endpoint
any database or RPC error, and any function status other than a definite
not-found / revoked / expired / reused, is 503 with `Retry-After: 5`. At
`/api/mcp`, a lookup error for an OAuth token is 503, never 401. Tested by
making the database client fail.

**A4 (E4) The two client documents are pinned in code, not fetched.** The
CIMD draft allows this (§9.2 "pre-register Client Identifier URLs … while not
relying on the authorization server automatically fetching client metadata
at request time"). `src/lib/oauth/clients.ts` holds exactly the two
`client_id` URLs with their `redirect_uris` and labels. No request-time
fetch exists anywhere, which removes SSRF, size, timeout, caching and
claude.ai availability from the picture. A script,
`scripts/check-claude-clients.mjs`, fetches both documents read-only and
fails if they differ from the pinned copy; it is run before launch and can be
run any time.

**A5 (E5) The phishing case (D3).** Still not closable by Splittr alone for
the hosted client; it depends on whether `claude.ai/api/mcp/auth_callback`
binds the flow to the claude.ai session that started it. So:
- A binding cookie: `/oauth/authorize` sets a random, HttpOnly, Secure,
  SameSite=Lax cookie scoped to `/` named `__Host-splittr-oauth` (its SHA-256
  is stored on the request) and consent, approve and deny require it. The
  consent URL alone is useless to anyone else, and there is no "first viewer
  owns it" race. If a session exists at `/oauth/authorize`, the request is
  owned by that user immediately.
- Until the post-deploy test shows Claude binds its callback, the hosted
  client always requires the emailed code (a second warning, in the inbox);
  the fresh-sign-in shortcut applies to Claude Code only. This is one
  constant, `HOSTED_CLIENT_REQUIRES_EMAILED_CODE = true`.
- The "Claude was connected" email is sent before the approve response
  returns (awaited, not fire-and-forget).
- The post-deploy D3 test is recorded in this file.

**A6 (E6) Which Splittr account.** The consent page and the code email show
the signed-in email prominently, with "Not you? Switch account" (signs out
and returns to the consent page).

**A7 (E7) Grants become live at code redemption; several connections allowed.**
Approval creates the grant as `pending` (no access), and the code exchange
makes it live. Replacement happens at that moment, never earlier: an
abandoned or failed reconnect never disconnects anything. The unique index on
`(user_id, oauth_client_id)` is dropped; the cap is 5 live OAuth grants. The
consent page offers "Replace my existing <Claude / Claude Code> connection
from <date>", checked by default for the hosted client and unchecked for
Claude Code (two computers are normal). A replaced grant's unapproved
proposals are kept (replacement is not distrust). Pending grants that are
never redeemed expire with their code (5 minutes) and are pruned.

**A8 (E8) Revocation really covers OAuth.**
- `/api/mcp`'s query-string leak check also recognises `spl_oat_` and
  `spl_ort_` and revokes their grant.
- Personal-token caps count `kind = 'pat'` only: the route
  (`src/app/api/agent-tokens/route.ts`) and `mint_agent_token` (re-created in
  019).
- OAuth grants get a `revoke_link_hash`, so the "Not you?" link in the
  connected email works.
- A trigger on `agent_tokens`: when `revoked_at` becomes non-null, delete that
  grant's `agent_oauth_tokens` and `agent_oauth_codes`. The liveness join at
  `/api/mcp` stays the guarantee.

**A9 (E9) The issuer is configuration.** `OAUTH_ISSUER` (default
`CANONICAL_ORIGIN`) builds every document, the `iss` parameter and the
resource URL (`<issuer>/api/mcp`). OAuth refuses to turn on unless
`VERCEL_ENV === 'production'` or the issuer's host is `localhost` /
`127.0.0.1`, so a preview can never issue tokens against the production
database. `scripts/local-env.sh` sets `OAUTH_ISSUER=http://localhost:3199` and
`MCP_OAUTH_ENABLED=true`.

**A10 (E10) Anthropic's traffic must reach us.**
- `/api/mcp` accepts no `Origin`, the request's own origin, and
  `https://claude.ai` (cookies are never read there, so this is not a CSRF
  risk); other browser origins stay 403.
- Owner action: a Vercel firewall rule that bypasses the automatic challenge
  for `160.79.104.0/21` on `/api/mcp`, `/api/oauth/*` and `/.well-known/*`.

**A11 (E11) Missing pieces added.**
- RFC 7009 revocation endpoint `POST /api/oauth/revoke` (form; `token`,
  optional `token_type_hint`, `client_id`), advertised as
  `revocation_endpoint`; revoking either token revokes the grant; always 200
  for unknown tokens.
- Audit rows (tool `oauth`) for: request created, consent shown, approved,
  denied, code exchanged, refresh, reuse-revocation, code-replay-revocation,
  revocation-endpoint use.
- Kill switch: with `MCP_OAUTH_ENABLED` off, discovery and `/oauth/authorize`
  are 404, the token and revocation endpoints 503, `spl_oat_` tokens at
  `/api/mcp` 503; grants are untouched. Runbook SQL to revoke every OAuth
  grant in `docs/specs/mcp-implementation.md`.

**A12 (E12) Code replay.** Only a replay that passes the client,
`redirect_uri` (when sent) and PKCE verifier checks revokes the grant; any
other use of a used code is a plain `invalid_grant`.

**A13 (E13) Throttling forged tokens.** OAuth tokens carry a keyed check:
`spl_oat_<43 base64url>_<8 base64url of HMAC(k, body)>` (same for `spl_ort_`),
verified before any database access. A missing credential is never counted by
the failed-auth limiter (every first connection from Anthropic's addresses
starts with one).

**A14 (E14) Lenient where it costs nothing, strict where it matters.**
`state` up to 2048 characters; the token endpoint ignores an `Authorization`
header or `client_secret` from these public clients; `redirect_uri` at the
token endpoint is optional (exact match when present); `scope` on refresh is
ignored; `application/x-www-form-urlencoded` with any charset parameter is
accepted; any parameter given twice is `invalid_request` at both endpoints.

**A15 (E15) Plumbing.**
- `/oauth/authorize` is a GET route handler (it writes a row and a cookie).
  It creates at most 20 requests per IP per 10 minutes (in memory) and 10 per
  user per 10 minutes.
- The session-bound consent APIs live under `/api/agent-oauth/*` (inside the
  proxy matcher); only `/api/oauth/*` (token, revoke) and `/.well-known/*`
  are excluded from it.
- Approve and deny both answer JSON with a URL and the page navigates with
  `location.assign` (the CSP's `form-action 'self'` blocks redirecting form
  posts).
- The `.well-known` routes are verified under `next start` locally and again
  on the deployment.

**A16 (E16) The fresh-sign-in check reads verified claims.** `amr` comes from
`supabase.auth.getClaims()` (signature verified against the project JWKS) via
the R-O1-guarded client, never from a decoded cookie. Tests cover a first
sign-up, the `token_hash` path and the `?code=` path of `/auth/callback`,
and code entry on `/signin`, and record each one's `amr` method name.

**A17 (E17) Token handling.** Hash the full string including its prefix;
store the token type and check it at lookup; `spl_ort_` at `/api/mcp`,
`spl_oat_` or `spl_pat_` at the token endpoint, and `spl_oat_` as a refresh
token all fail cleanly.

**A18 (E18) The exact URL.** The profile page's connect instructions show
`https://www.splittr.cash/api/mcp` with a copy button and say it must be
typed exactly (no apex domain, no trailing slash).

Facts corrected (§11): Claude's documents are served with
`cache-control: public, max-age=300` (irrelevant now they are pinned);
Claude Code's document lists only `localhost` and `127.0.0.1`, so `[::1]` is
not matched; 5 KB is a recommendation; a hosted `/confidential_client`
variant exists and is used only if `private_key_jwt` is advertised, which it
must never be (tested).

To test against the real clients after deploy: claude.ai's `state` length;
whether hosted Claude sends `Origin`, `redirect_uri` or `scope` on token
requests; that it accepts a narrower `scope`; whether it checks `iss`; the D3
callback binding; signed-out connection from Desktop, iOS, Android and
Cowork; the minimum Claude Code version that uses CIMD.

Owner actions at launch, replacing §12 S12:
1. Apply migrations 015–019 in order (after the code is deployed).
2. Paste the updated magic-link template into Supabase (Authentication →
   Emails → Magic Link).
3. Vercel firewall: bypass the automatic challenge for `160.79.104.0/21` on
   `/api/mcp`, `/api/oauth/*`, `/.well-known/*`.
4. Vercel Production env: `MCP_ENABLED=true`, `AGENT_TOKEN_PEPPER` (32+
   bytes), `MCP_OAUTH_ENABLED=true`. Nothing in Supabase's OAuth settings.

## 14. API contracts (backend ⇄ UI) for Part 2

```
GET  /oauth/authorize?response_type&client_id&redirect_uri&code_challenge
                     &code_challenge_method&state&scope&resource
  route handler. Invalid client or redirect_uri: 400 HTML error page, no
  redirect. Other errors: 302 to redirect_uri?error=...&state=...&iss=...
  Success: sets the binding cookie, 302 to /oauth/consent/<request_id>.

page /oauth/consent/[id]
  signed out: link/redirect to /signin?next=/oauth/consent/<id>
  uses GET /api/agent-oauth/requests/<id> for everything it shows.

GET  /api/agent-oauth/requests/[id]        session + binding cookie
  200 { id, destination: 'claude.ai' | 'loopback', destination_label,
        redirect_host, client_name, requested_scopes: string[],
        expires_at, account_email,
        step_up: { fresh_sign_in_ok: boolean, code_required: boolean,
                   code_sent: boolean },
        existing: [{ id, destination, connected_at, scopes }],
        replace_default: boolean }
  404 for anyone else, expired, already decided, or missing cookie.

POST /api/agent-oauth/requests/[id]/code   send the emailed code
  200 { code_expires_at } | 429 { code, retry_after } | 503 email_unavailable

POST /api/agent-oauth/requests/[id]/approve
  body { scopes: ['read'] | ['read','bills:write'], replace: boolean,
         code?: '123456' }
  200 { redirect_url } | 400 { code: 'wrong_code', attempts_left }
  | 400 { code: 'code_required' | 'expired' | 'invalid_input' }
  | 409 { code: 'grant_limit' } | 429 { code: 'locked', retry_after }

POST /api/agent-oauth/requests/[id]/deny
  200 { redirect_url }

POST /api/oauth/token     form; RFC 6749 JSON responses (see §12 S6, A1, A3)
POST /api/oauth/revoke    form; RFC 7009

GET  /api/agent-tokens    TokenRow gains kind: 'pat' | 'oauth',
  destination?: 'claude.ai' | 'loopback', and last4 is null for oauth rows.
  Revoke and resume routes work for both kinds.
```

## Part 2 build decisions

Things §12 to §14 did not settle, or where the build chose the stricter
option (WP9). Numbered for reference.

1. **Check suffix includes the type.** The 8-character check is
   HMAC(k, "at|" or "rt|" + body), not HMAC(k, body), so swapping
   `spl_oat_` for `spl_ort_` breaks the check. Stored hashes cover the full
   string either way.
2. **Binding cookie name on http.** `__Host-splittr-oauth` with Secure on an
   https issuer. A `__Host-` cookie cannot exist without Secure, so on an http
   issuer (only ever `http://localhost`, A9) the cookie is `splittr-oauth`
   without Secure. One helper (`bindingCookieName`) decides. One cookie name
   means two simultaneous connections in one browser overwrite each other.
3. **`amr` method names (A16), measured on the local stack.**
   `verifyOtp({ token_hash })` (types `email` and `magiclink`, new and
   existing accounts): `otp`. `verifyOtp` with the 6-digit code: `otp`.
   `exchangeCodeForSession(?code=)` after the emailed link (PKCE, the path
   `/auth/callback` uses by default): **`magiclink`**, not `otp`. Password:
   `password`. A Supabase OAuth-client session: `oauth_provider/authorization_code`
   plus a `client_id` claim. A "fresh sign-in" is therefore an entry with method
   `otp` or `magiclink`, at most 10 minutes old and at most 60 s in the
   future; nothing else counts. (A check for `otp` alone would have refused
   the default sign-in path.) A first-time account's emailed token only
   verifies as type `email`. `getClaims()` through the guarded client already
   returns no claims for an OAuth-token cookie (the guard overrides
   `getSession`, which `getClaims` calls); `readFreshSignIn` also requires
   `sub` to equal the user and refuses any `client_id` claim.
4. **Token endpoint errors.** Missing `client_id`, `grant_type`, `code`,
   `code_verifier`, `refresh_token`: `invalid_request`. Unknown `client_id`:
   `invalid_client` 401. A malformed code or verifier, any binding mismatch,
   an access or personal token used as a refresh token: `invalid_grant`.
   `resource` that does not canonicalise to ours: `invalid_target`; one that
   does (trailing slash, host case, default port) is accepted.
5. **Failed bindings do not consume a code.** The app compares client,
   `redirect_uri` and the PKCE verifier (constant time) and passes the result
   to `oauth_redeem_code`; a failed binding on an unused code is `invalid` and
   leaves the code usable. A used code replayed with all bindings correct
   revokes the grant (A12); the function also returns `replayed` to the
   parallel losers of a race, so parallel redemption of one code ends with one
   winner and a revoked grant.
6. **Replacement is snapshotted at approval, applied at redemption.** The
   grants "replace" means are the account's live grants for the same client at
   approval time, stored on the code; at redemption those still live are
   revoked with reason `replaced` and their proposals kept
   (`proposalTokenRevoked` ignores that reason). Known gap: a later
   revoke-all does not delete proposals of an already replaced grant (they
   expire on their own).
7. **Cap is checked twice.** At approval (live grants, minus those being
   replaced, at most 5) and again at redemption under the same lock, so
   several approvals made while below the cap cannot all go live. A
   redemption over the cap revokes the pending grant (`grant_limit`) and
   replaces nothing.
8. **Grant expiry.** A pending grant expires with its code (5 minutes); at
   redemption it becomes a 90 day grant. Pending grants are pruned a week
   after expiring. Refresh tokens expire with the grant.
9. **Wrong-code accounting.** Approve checks the 24 hour lock first (also for
   the fresh sign-in path), then request validity, scopes, the cap, then the
   code. A missing or expired code is `code_required` and costs no attempt; a
   wrong or malformed one costs an attempt (5 per code) and counts toward
   `agent_mint_state`. A code is single use (cleared on approval) and a new
   code resets the attempts. Exhausted attempts answer `code_required` with
   `attempts_left: 0` (the contract has no separate code).
10. **Lock order** in every function: per-account advisory lock, then the
    grant row, then code or token rows, which is the order a revocation takes
    them in.
11. **Consent API status codes.** No session: 401. Bad or missing binding
    cookie, other account, decided or expired request: 404 (approve reports an
    owned, expired request as 400 `expired`). The first signed-in account to
    present the cookie claims an unowned request with a conditional update.
    `consent_shown` is audited on every GET. `fresh_sign_in_ok` is always
    false for the hosted client. `replace_default` is true for the hosted
    client, false for Claude Code. The code route also refuses while locked.
12. **Revocation endpoint.** `client_id` is required (missing: 400, unknown:
    401); a token of another client, an unknown, malformed or forged token,
    or an already revoked grant is 200 with no change. A database error is 503.
    Same-site Origin is not required (not a browser endpoint).
13. **Emails on server-initiated revocation.** Both refresh-token reuse and
    code replay revoke the grant, delete its unapproved proposals, write an
    audit row and email the owner (the spec asked for the reuse email only).
    Revocation by the client itself is audited, not emailed.
14. **Rate limits.** Token endpoint: 60 per minute per grant (database,
    `hitRateLimit`, which now also reports `unavailable` so a database error
    is 503 rather than 429), 30 failures a minute per address in memory for
    requests that fail before a grant is identified, then 429. Authorize: 20
    per address in memory, 10 per account (database), both per 10 minutes;
    over the limit redirects with `temporarily_unavailable`.
15. **Discovery.** The authorization server document also carries
    `revocation_endpoint_auth_methods_supported: ["none"]` (otherwise RFC 7009
    clients assume `client_secret_basic`). `.well-known` folders under `app/`
    route normally in Next 16 (see the build report); no rewrite is needed.
16. **Pending and OAuth rows in the existing list.** `GET /api/agent-tokens`
    does not yet filter or reshape OAuth rows (null `last4`, pending grants):
    that is the profile work package. The PAT cap in the route counts
    `kind = 'pat'` and falls back to counting all rows if the column is
    missing (before migration 019).
17. **Revoke-link secret** for an OAuth grant is stored like a PAT's; the
    link in "Claude was connected" uses the issuer origin.
