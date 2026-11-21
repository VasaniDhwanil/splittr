# MCP agent access: implementation notes

Companion to `docs/specs/mcp-server.md` (the spec, v4). The spec says what and
why; this file says how the build is split up, what is already done, the
decisions made while building, and the contracts between the pieces. Each
work package below is done by one agent, one at a time.

## Ground rules for every work package

- **Read first:** `AGENTS.md` (this is Next.js 16: check
  `node_modules/next/dist/docs/` before using a Next API), the spec sections
  named in your package, and this file.
- **Node 20:** prefix commands with
  `export PATH="/opt/homebrew/opt/node@20/bin:$PATH"`. The default `node` is 18
  and breaks vitest, Playwright and the build.
- **Never touch production.** No `git push` (a push deploys). No Supabase MCP
  tools (`mcp__supabase__*`) at all: they point at the production database. No
  Vercel CLI. No real email. The only database is the local stack.
- **Local database:** already running (`docker ps` shows `supabase_*_splittr`).
  If it isn't: `npm run db:start`. After changing a migration file:
  `npm run db:reset` (wipes local data, replays `supabase/migrations/`).
  Migrations are plain SQL files named `NNN_name.sql`; never apply them
  anywhere else.
- **`.env.local` is production.** It holds the production Supabase URL and
  service key, the Resend key and the Anthropic key, and Next bakes
  `NEXT_PUBLIC_*` values in at build time. So never run `next dev`,
  `next build` followed by `next start`, or any script against a server,
  without first running `source scripts/local-env.sh` in the same shell. That
  script exports the local stack's Supabase settings, a test pepper,
  `MCP_ENABLED=true`, and empty `RESEND_API_KEY` / `ANTHROPIC_API_KEY`
  (variables already set in the shell win over `.env.local`, including empty
  ones). Rebuild after sourcing it: a `.next` built without it talks to
  production. Before the first request, confirm the server is local: the
  script prints the URL it exported, and it must be `http://127.0.0.1:54321`.
  `npm run test:server` and `npm test` are safe on their own (they never read
  `.env.local` and refuse non-local URLs).
- **Tests first.** Write the failing test, watch it fail, then write the
  code. Server tests: `npm run test:server` (vitest, node, real local
  Postgres, files in `tests/server/`). Pure-logic tests: `npm test`
  (`tests/unit/`). Helpers: `tests/server/helpers/db.ts` (`createUser`,
  `createBill`, `joinBill`, `createGroup`, `request`, `params`, `sql`, `db`)
  and `tests/server/helpers/session.ts` (`signInAs`, `signOut`). The cookie
  client `@/lib/supabase/server` is mocked for every server test in
  `tests/server/setup-env.ts`; handlers keep calling `createClient()` as the
  existing routes do.
- **Before you finish:** `npm run test:server`, `npm test`,
  `npx tsc --noEmit`, `npm run lint` and `npm run build` all pass.
- **Commits:** small, one logical unit each, descriptive message in the style
  of `git log`, ending with the line
  `Co-Authored-By: Claude <noreply@anthropic.com>`. Stage files by name
  (never `git add -A` / `git add .`). Never stage anything under `video/`,
  `.claude/`, `.agents/`, or `skills-lock.json`. Do not push.
- **Another session shares this checkout** and commits its own work under
  `video/`. Never touch `video/`. Commit with explicit paths
  (`git add <new files>` then `git commit -m "..." -- <paths>`), which
  commits only those paths even if something else is staged.
- **Code style:** match the surrounding code (2-space indent, single quotes in
  `src/`, comments only where they state a constraint the code can't show).
  No em-dashes in user-facing copy. Server-only modules never get imported
  from client components.
- **Both database states:** production does not have migrations 015–017 yet,
  and the web app must keep working there after a deploy. Anything on an
  existing web path must tolerate the new tables and columns being absent
  (see "Works before and after the migration" below).
- **Report back:** what you changed, test counts, anything you could not do or
  chose differently from this file, and anything that looked wrong in work
  you did not write.

## What exists already

**Committed so far (before WP3):** WP0 (Phase 0 and the harness, `e95c8c4`..`417184d`) and
WP1 (tokens, `f209659`..`ca8975c`), the Next.js security patch to 16.4.6
(`dcc0028`), and WP2 (`/api/mcp` and the read tools, `ebab167`..`5edfc50`).
183 server tests and 124 unit tests pass, with type-check, lint and build.

| Area | Files | State |
|---|---|---|
| Test harness | `vitest.server.config.ts`, `tests/server/global-setup.ts`, `tests/server/setup-env.ts`, `tests/server/helpers/*`, `supabase/config.toml`, `package.json` scripts (`test:server`, `db:start`, `db:stop`, `db:reset`), `pg` devDependency | committed |
| P1 group filing | `src/app/api/bills/[id]/route.ts` (PATCH), `supabase/migrations/015_group_membership_history.sql`, `tests/server/phase0-group-filing.test.ts` | committed |
| P2 claims auth | `canEditClaims` in `src/lib/auth-helpers.ts`, `src/app/api/claims/route.ts`, `src/app/api/claims/batch/route.ts`, client in `src/app/bill/[id]/page.tsx`, `scripts/api-scenario-test.sh`, `scripts/realtime-doorbell-probe.mjs`, `e2e/realtime.spec.ts`, `tests/server/phase0-claims-auth.test.ts` | committed |
| P4 one row per account | `src/app/api/bills/claim/route.ts`, `src/app/api/participants/route.ts` (23505 handling), `supabase/migrations/016_one_participant_per_account.sql`, claim prompt copy in `src/app/page.tsx`, `tests/server/phase0-participant-identity.test.ts` | committed |
| P5 bill privacy | GET in `src/app/api/bills/[id]/route.ts`, `publicBill` / `memberBill` in `src/lib/auth-helpers.ts`, `src/types/index.ts`, payer logic in `src/app/bill/[id]/page.tsx`, `tests/server/phase0-bill-privacy.test.ts` | committed |
| Proxy | `src/middleware.ts` renamed to `src/proxy.ts` (Next 16), `/api/mcp` excluded from the matcher, `tests/server/proxy-matcher.test.ts` | committed |
| Feature, pure logic | `src/lib/agent-tokens.ts`, `src/lib/mcp/sanitize.ts`, `src/lib/mcp/guardrails.ts`, `tests/unit/agent-tokens.test.ts`, `tests/unit/mcp-sanitize.test.ts`, `tests/unit/mcp-guardrails.test.ts` | committed (WP1) |
| Feature, schema | `supabase/migrations/017_agent_access.sql` | committed (WP1); functions tested, including races |
| Feature, email | `src/lib/agent-emails.ts` (`buildAgentCodeEmail`, `buildAgentTokenCreatedEmail`, `buildAgentTokenStoppedEmail`); `emailShell` and `escapeHtml` exported from `src/lib/email.ts` | committed (WP1) |
| Tokens (WP1) | `src/lib/agent-access.ts`, `src/app/api/agent-tokens/**`, `/auth/callback` lock clearing, `tests/server/agent-*.test.ts`, `tests/server/helpers/agent.ts`, `tests/unit/agent-emails.test.ts` | committed |
| Dependencies | `@modelcontextprotocol/sdk@1.32.2`, `zod@4.3.5` in `package.json` | committed |

Production facts checked read-only on 2026-11-20: Postgres 17.6; 22 bills, 58
participants; no account has two rows on one bill; no group bill has a
non-member creator; 3 claimed bills have no host row linked to the account.

**Schema drift check (spec §7.1 item 2), done 2026-11-20.** Migrations
001–017 replay cleanly on a fresh local stack. A fingerprint of the seven
app tables (columns, constraints, indexes, RLS, triggers, table and column
grants, default privileges), the `realtime.messages` policy, the realtime
publication and the storage bucket was taken from production and from the
local replay. They are identical apart from what 015–017 add, and one SQL
comment inside `ring_bill_doorbell()`. So the local database is a faithful
stand-in for production. (Done with read-only introspection queries instead
of `supabase db diff --linked`, which needs the database password.)

## Decisions made while building (where this differs from or sharpens the spec)

1. **Supabase CLI via `npx supabase@2.122.0`**, not a devDependency: its
   install script downloads a binary, which does not belong in Vercel builds.
2. **Sessions in tests** are injected by mocking `@/lib/supabase/server`, not
   by rewriting handlers as factories. New handlers call `createClient()`
   like the old ones.
3. **Email in tests:** `vi.mock('@/lib/email', ...)` keeping the real
   builders and replacing `sendEmail` / `isEmailConfigured` to capture
   messages. No test-only hook in production code.
4. **P1 audit** is a database function, `public.audit_group_bills(detach)`,
   run once by migration 015. Membership history is written by a trigger on
   `group_members`, so no route had to change.
5. **P2** accepts: `X-Participant-Token` of anyone on the item's bill, the
   bill's creator token, or a signed-in account that created or is on the
   bill. A device that only "adopted" an existing name has none of these and
   gets 403 with `code: 'not_on_bill'`; the bill page then asks it to join.
6. **P5:** `GET /api/bills/[id]` returns `user_id` only on the viewer's own
   participant row (members of the bill's group also get it for fellow
   members' rows: the group page computes its ledger from this endpoint); `creator_user_id`, `group_id`, `paid_by_user_id` and
   `group_members` only to the bill's creator (by session) or members of its
   group; `paid_by.participant_id` tells the page who collects.
   `publicBill()` is now an allow-list.
7. **Wrong-code lock** lives in the database (`agent_mint_state`, inside
   `mint_agent_token`), not in the shared rate limiter: ten wrong codes in 24
   hours lock minting for 24 hours. Cleared by deleting the row.
8. **One gate, no exceptions:** a bill awaiting approval is not-found on every
   ordinary bill endpoint, even for its creator. The creator sees it only
   through `/api/agent-bills/[id]` and the `/approve/[id]` page.
9. **Agent-created bills store no creator token** (`creator_token` NULL); the
   owner manages them by session.
10. **Realtime doorbell needs no gate:** its payload is only
    `{ table, bill_id }` and its topic is the unguessable bill id.
11. **claude.ai traffic is not detected by User-Agent** (not reliably
    identifiable); the mint screen's warning is the control, as the spec
    allows.
12. **Canonical URL** is `https://www.splittr.cash` (`CANONICAL_ORIGIN` in
    `src/lib/site-origin.ts`); the MCP endpoint is
    `https://www.splittr.cash/api/mcp`.
13. **Client IP** for agent access comes from `x-real-ip` (falls back to
    `'unknown'`), not the first `x-forwarded-for` entry.
14. **Feature switch:** `isAgentAccessEnabled()` in `src/lib/agent-tokens.ts`
    is true only when `MCP_ENABLED === 'true'` and `AGENT_TOKEN_PEPPER` is at
    least 32 bytes. Off means: `/api/mcp` answers 503, every
    `/api/agent-tokens*` and `/api/agent-bills*` route answers 404 (except
    `GET /api/agent-tokens`, which answers `{ enabled: false, tokens: [] }`
    so the profile page can hide the section).
15. **Token routes check in this order:** feature switch (404), same-site
    `Origin` (403, a missing `Origin` is refused too), session (401), input
    (400), wrong-code lock (429), token cap (409), request rate limit (429),
    email. A locked or full account never spends a code request.
16. **A malformed code costs an attempt** like any wrong code (`wrong_code`
    with `attempts_left`); there is no `invalid_input` for the code itself.
17. **`revoke-link`** also requires a same-site `Origin`, so the
    `/agent-tokens/revoke` page must call it with `fetch`. It revokes every
    unrevoked token of the owner, answers 200 `{ revoked: 0 }` when pressed
    again, and 404 only for an unknown or malformed secret.
18. **`DELETE /api/agent-tokens/[id]`** answers 200 for the owner's
    already-revoked token; `resume` answers 404 for a revoked one.
19. **Global sign-out does end old sessions for this app.** Tested: after
    `signOut({ scope: 'global' })`, `getUser()` with a previously issued
    access token returns no user. The proxy and every route use `getUser()`,
    so the spec's "valid for up to an hour" caveat (D10) does not apply here.
    It would apply to code that trusted the JWT locally (`getClaims()`).
20. **Order inside `/api/mcp`:** 503, foreign `Origin` (403), token in the
    URL, then 405 for every method but POST, then the Authorization header.
    So a GET with a token in its URL still revokes that token, and a GET
    without one answers 405 rather than 401.
21. **Failed-auth counter:** 30 failures a minute per `x-real-ip`, in memory.
    Past that, failures answer 429 instead of 401 (still after the lookup).
    A valid token never touches the counter and is never refused because of
    it. It limits noise; it does not save the lookup.
22. **Errors are JSON-RPC envelopes** (`{ jsonrpc, error: { code, message,
    data: { reason } }, id: null }`) for every pipeline refusal, with
    `Cache-Control: no-store`. Non-Bearer schemes count as "missing".
23. **Unknown-tool audit rows** store the tool name `(unknown)`, not the name
    the caller sent, so out-of-scope and nonexistent tools are
    indistinguishable in the log as well as in the response.
24. **Group bills filed by a non-member are visible to current members**
    (spec D7: P1 blocks and remediates planting; D7 deliberately does not
    require the creator to still be a member). Unpublished ones never are.
    If that stops being acceptable, the check belongs in `findRelatedBills`
    and `findRelatedBill` (authz.ts), and the T-AUTHZ matrix has the row.
25. **Query shape:** three scoped queries merged in code (created by the
    actor; inner join on the actor's participant row; `group_id in` the
    actor's current groups), each carrying the published filter. A bill is
    re-checked against the relation in code as a second layer. Detail reads
    (items, participants, claims) only accept bills the finders returned.
26. **`status` filter of `list_my_bills` is literal** (`active` does not
    include `draft`). `list_my_expenses` and `list_my_bills` read at most
    PostgREST's 1000 rows per source; balances read all unsettled related
    bills in one go, which is fine at this size but not paged.
27. **Tool results carry the data twice:** as JSON text in `content` and as
    `structuredContent` (no `outputSchema` is declared).
28. **`paid` on a person** is the raw payment status of their row; the person
    collecting is not marked paid. `my_payment_status` is `not_applicable`
    for the collector.
29. **`scripts/local-env.sh`** (WP3): `source` it before any server or build.
    It reads `supabase status -o env`, refuses unless the URL is the local
    stack, and prints only the URL. The pepper it sets is a fixed 40-character
    test value.
30. **`create_bill`'s schema is as loose as the web's** (up to 100 items, price
    up to 100000), and the agent limits (40 items, $1,000 a unit, $2,000 a
    total) are drawn by `checkBillInput`. A tighter schema would answer
    `invalid_input`, which is not audited as a refusal and never reaches the
    circuit breaker, making `too_many_items` and `unit_price_cap` unreachable.
    The tool description states the real limits.
31. **Daily cap** is `hitRateLimit('agent-bills:<user>', 20, 86400)`: a fixed
    window aligned to UTC midnight, per account across all its tokens. Around
    midnight an account can get up to 40 proposals in 24 hours. Only calls that
    passed the input policy and the duplicate check spend it.
32. **Audit vocabulary:** `create_bill` writes `ok`, `invalid_input`,
    `refused:<code>` (`too_many_items`, `unit_price_cap`, `total_cap`,
    `duplicate`, `daily_cap`) or `error`. The owner's choices write tool
    `approval`, outcome `approval_approved` / `approval_declined`, against the
    creating token (token id null when the token no longer exists; then
    nothing is counted). The breaker writes tool `token`, outcome `suspended`;
    `resume` writes `resumed`, and the breaker counts only rows after the
    latest `resumed` in the window, or a resumed token would be paused again
    by its next refusal.
33. **Breaker:** counted refusals are `total_cap`, `unit_price_cap`,
    `too_many_items`, `duplicate` (5 in the last hour) and declines (3 in the
    last hour, decline of an expired proposal included). The suspension is a
    conditional update (`suspended_at is null`), and only the call that wins
    it sends the email, so parallel refusals send one. The next MCP call is
    401 with reason `suspended` and the stored reason appended ("Why: ...").
34. **Unpublished bills on claim routes** answer as a missing item (400 on
    POST and batch, 404 on DELETE), not 403 `not_on_bill`, so they cannot be
    told apart from a nonexistent item. Participant routes answer "Participant
    not found" / "Bill not found". `canEditClaims` and `requireBillOwnership`
    also refuse, as a second layer.
35. **Link origin for agents** is `agentSiteOrigin()`: `NEXT_PUBLIC_SITE_URL`
    when set, else `CANONICAL_ORIGIN`. Never request headers. The breaker's
    email uses it too.
36. **Realtime doorbell is not gated** (decision 10), although spec T-GUARD
    lists it: its payload carries no bill data and its topic is the bill id.
37. **Approval routes:** `GET` needs the feature switch and a session but no
    Origin (it changes nothing); both POSTs need all three. Approve is one
    conditional `update ... where creator_user_id = caller and
    approval_required and approved_at is null and approval_expires_at > now`;
    decline is the same conditions as a `delete`. Zero rows then means 404,
    except an expired own proposal on approve, which is 410.
38. **Known gap:** two identical `create_bill` calls that run at the same
    instant can both pass the duplicate check (it is a read, then a write).
    The daily cap is atomic; the duplicate check is not.
39. **`/api/bills/mine`** returns an explicit field list plus the three new
    fields (it used to return whatever its column list named), built from
    `select('*')` so it works before migration 017.

## Launch checklist

Before turning the feature on in production (`MCP_ENABLED=true` plus the
pepper):

1. Apply migration 017 (and 015 and 016 before it, if not yet applied).
2. Confirm the nightly prune job exists:
   `SELECT 1 FROM cron.job WHERE jobname = 'prune-agent-access'`. It must
   return a row. If it does not (pg_cron missing or the schedule failed), the
   audit log and rate-limit tables grow without bound: schedule
   `SELECT public.prune_agent_access()` some other way (for example a Supabase
   scheduled function or an external cron calling it with the service role)
   before enabling the feature.
3. Set `AGENT_TOKEN_PEPPER` (at least 32 bytes) and `RESEND_API_KEY`.
4. Make one token, make a proposal with it, approve it, revoke the token.

## Works before and after the migration

- `isPublished(bill)` (new, `src/lib/bill-visibility.ts`): true unless
  `approval_required` is true and `approved_at` is null. A row without those
  columns is published.
- Never name the new columns in a `.select('a, b')` on an existing web path:
  PostgREST fails the whole query with code `42703` when a column is missing.
  Use `.select('*')` server-side, or retry without the new columns on
  `42703` (do this in one shared helper for the bill metadata and share
  images).
- Best-effort writes to new tables from old paths (`/auth/callback` clearing
  the mint lock) must ignore errors.

## API contracts (backend ⇄ UI)

All JSON. All POST/DELETE routes here require a same-site `Origin`
(`origin === new URL(request.url).origin` or in `ALLOWED_ORIGINS`), else 403.
All need a session (401) except `revoke-link`. Feature off: see decision 14.
Responses carrying a token set `Cache-Control: no-store`.

```
GET    /api/agent-tokens
  200 { enabled: boolean, mcp_url: string, tokens: TokenRow[] }
  TokenRow = { id, name, last4, scopes: ('read'|'bills:write')[], created_at,
               expires_at, last_used_at: string|null, last_used_ip: string|null,
               status: 'active'|'suspended'|'expired'|'revoked',
               suspended_reason: string|null, revoked_reason: string|null }
  (revoked and expired tokens are listed for 30 days, newest first)

POST   /api/agent-tokens            { name, scopes, expires_in_days: 7|30|90 }
  200 { ok: true, code_expires_at }            a code was emailed
  400 { error, code: 'invalid_input' }
  409 { error, code: 'token_limit' }           already 5 active tokens
  429 { error, code: 'rate_limited'|'locked', retry_after }
  503 { error, code: 'email_unavailable' }

POST   /api/agent-tokens/verify     { code: '123456' }
  200 { token, id, name, scopes, last4, expires_at }   token shown this once
  400 { error, code: 'wrong_code', attempts_left }
  400 { error, code: 'expired'|'no_pending'|'too_many_attempts' }
  409 { error, code: 'token_limit' }
  429 { error, code: 'locked' }

DELETE /api/agent-tokens/[id]             200 { ok: true } | 404
POST   /api/agent-tokens/[id]/resume      200 { ok: true } | 404   (clears a suspension)
POST   /api/agent-tokens/revoke-all       200 { revoked: number, signed_out: boolean }
POST   /api/agent-tokens/revoke-link      { secret }   no session
  200 { revoked: number } | 404
  page: /agent-tokens/revoke?s=<secret>   (GET renders a confirm button only)

GET    /api/agent-bills/[id]              the creator's view of a proposed bill
  200 { id, name, items: [{ name, price, quantity }], subtotal, tax,
        tip_amount, total, split_mode, created_at, expires_at,
        token_name: string|null, warnings: string[] }
  404 for anyone else, for approved bills, and for expired ones
POST   /api/agent-bills/[id]/approve      200 { ok: true, bill_id } | 404 | 410 { code: 'expired' }
POST   /api/agent-bills/[id]/decline      200 { ok: true } | 404
  page: /approve/[id]

GET    /api/bills/mine
  each row gains  approval: 'none'|'pending',  created_via: 'web'|'agent',
  approval_expires_at: string|null.  Pending rows whose approval has expired
  are left out.
```

## Work packages

### WP0. Verify and commit Phase 0 and the harness
Spec §3, §7.1, T-PRE. Run the Phase 0 server tests, fix whatever fails (in the
code, the tests or migrations 015/016, whichever is actually wrong), then
commit. Suggested commits: harness (+ dependencies); P1 with migration 015;
P2; P4 with migration 016; P5; proxy rename. Where two fixes share a file
(`bills/[id]/route.ts`, `bill/[id]/page.tsx`, `auth-helpers.ts`) one combined
"Phase 0" commit for those files is fine. Leave the feature files
(`src/lib/agent-*.ts`, `src/lib/mcp/`, migration 017, `tests/unit/agent-*`,
`tests/unit/mcp-*`, this file) uncommitted for WP1.

### WP1. Tokens: mint, list, revoke
Spec D2, D3, D10, T-TOK, T-MINT, T-REV.
- `src/lib/agent-access.ts` (server-only): `Actor`, `resolveAgentToken(token)`
  (shape check with zero database calls for malformed input, then lookup by
  hash; reasons `malformed | unknown | expired | revoked | suspended`),
  `hitRateLimit(key, limit, windowSeconds)` over `agent_rate_limit` (deny if
  the call errors), `auditAgentCall`, `touchAgentToken` (at most one write a
  minute per token), `requestIp`, and a same-site `Origin` check.
- Routes per the contracts above. Request limits: 3 code requests per account
  per hour and 10 per day (`hitRateLimit`). The request route upserts the
  account's single `agent_token_pending` row, emails the code
  (`buildAgentCodeEmail`), and deletes the row again if the email fails. The
  verify route computes the HMAC and the new token in the app, calls
  `mint_agent_token` once, maps its `status`, and on `ok` sends
  `buildAgentTokenCreatedEmail` with `/agent-tokens/revoke?s=<secret>`
  (best effort). Plaintext token and code never reach the database or a log.
- `revoke-all`: revoke every active token, `supabase.auth.signOut({ scope:
  'global' })`, and only if that succeeded delete the `agent_mint_state` row.
  `/auth/callback`: after a successful verification, delete the caller's
  `agent_mint_state` row (best effort, both database states).
- Development only (`NODE_ENV === 'development'`) and only when Resend is not
  configured: log the code to the server console so the flow can be tried
  locally. Never in production builds.
- Tests include the three races, run against `mint_agent_token` directly with
  `Promise.all` over `db().rpc(...)`: ten correct verifies make one token; ten
  wrong ones stop at five attempts; a sixth token is refused at five active.
  Also: `mint_agent_token` and `agent_rate_limit` are not callable with the
  anon key through `/rest/v1/rpc`.

### WP2. `/api/mcp`: transport, authorization, read tools
Spec D4–D9, D12 (G3, G5), §5, T-XPORT, T-SCOPE, T-AUTHZ, T-LEDGER, T-DTO,
T-INJ, T-ANNOT, T-RATE.
- `src/app/api/mcp/route.ts` (thin) + `src/lib/mcp/*`. Use the SDK's
  low-level `Server` with `WebStandardStreamableHTTPServerTransport`
  (`sessionIdGenerator: undefined`, `enableJsonResponse: true`), a fresh
  server and transport per request. GET and DELETE answer 405.
- Order of checks, each with its own exit: feature switch (503); foreign
  `Origin` (403; no `Origin` is fine); a well-formed token anywhere in the
  query string (revoke it with reason `query_string`, email the owner, 401
  saying why); `Authorization: Bearer` shape (401, no database); token lookup
  (401 with a body that says what is wrong and that a new token is made under
  Agent access on the profile; no `WWW-Authenticate` OAuth metadata); 60 calls
  a minute per token (429 + `Retry-After`); then JSON-RPC. Failed
  authentications are counted per IP in memory only and never block a valid
  token. Cookies are ignored throughout; responses never set them. Nothing
  logs headers.
- Tools are a registry: `name`, `scope`, `description`, strict zod input
  schema (unknown keys rejected), `annotations`, `handler(actor, input)`.
  `tools/list` returns only what the token's scopes allow; calling anything
  else, known or not, gives the same "unknown tool" error and writes nothing.
  Read tools: `readOnlyHint: true`. `initialize` carries `instructions` (G5).
- `src/lib/mcp/authz.ts`: every query is filtered by the actor in the query
  itself. A bill is related when the actor created it, has a participant row
  on it (`user_id`), or is a current member of its group. Unrelated and
  nonexistent ids give the identical error. Unpublished bills are never
  returned by read tools.
- Output rules: allow-listed DTOs built field by field; every string through
  `cleanForAgent`; text the actor did not write goes through `untrusted()`
  into fields named `untrusted_*`; participants without an account get no
  name at all (a count and their shares); nobody else's `user_id`; no
  `creator_token`, token hashes, emails, `zelle_*`. In `get_balances` only
  rows linked by `user_id` count; name-only matches go in a separate
  `unverified` list without handles; pay handles (Venmo, Cash App, PayPal)
  come only from the creditor's `profiles` row and only when the actor owes;
  two counterparties with the same display name get no handles. "My row" on a
  bill is the row with `user_id = actor`, else the host row when the actor is
  the bill's creator. Shares carry `as_of`.

#### Tool outputs (WP2)

Money is a number rounded to cents. Every money-bearing result carries
`as_of` (ISO time of the read). A text field is called `name` only when the
actor wrote it (their own bills, items, groups, their own participant name);
otherwise it is `untrusted_name` and has been through `untrusted()`. People
are identified by a `label` that is stable within one response: `you`,
`host`, `member #n` (has an account), `guest #n` (no account). Guests never
get a name field.

```
list_my_bills { limit?: 1..50 = 20, status?: 'active'|'settled' }
  { as_of, bills: [{ id, date, created_at, status, split_mode, total,
      role: 'creator'|'participant'|'group_member',
      name | untrusted_name,
      my_share: number|null, my_payment_status: 'paid'|'unpaid'|'not_applicable'|null }] }
  newest first; my_payment_status is 'not_applicable' when the actor is the
  one collecting, null when the actor has no row on the bill.

get_bill { bill_id: uuid }
  { as_of, id, date, status, split_mode, name | untrusted_name,
    subtotal, tax, tip, total,
    items: [{ name | untrusted_name, unit_price, quantity }],
    people: [{ label, is_you, is_host, has_account,
               name? (only when is_you) | untrusted_name? (others with an account),
               share, paid }],
    my_share: number|null }

list_my_groups {}
  { groups: [{ id, name | untrusted_name, member_count, role: 'owner'|'member' }] }

get_balances { group_id?: uuid }
  { as_of, scope: 'group'|'all',
    balances: [{ label: 'person #n', untrusted_name,
                 direction: 'you_owe'|'owes_you', amount,
                 pay_with?: { venmo?, cashapp?, paypal? } }],   // only when you_owe
    unverified: [{ kind: 'guest_owes_you'|'name_matches_you', bill_id, amount }],
    notes: string[] }

list_my_expenses { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }   // at most 366 days
  { as_of, from, to, total_my_share,
    expenses: [{ bill_id, date, name | untrusted_name, total, my_share,
                 payment_status: 'paid'|'unpaid'|'not_applicable',
                 role: 'creator'|'participant' }] }
  only bills where the actor has a row.
```

Balance rules. Over the related, published, unsettled bills (one group's, or
all of them): the creditor is `paid_by_user_id`, else `creator_user_id`
(skip the bill if neither is set). Shares come from `calculateSplits`. A
participant who is marked paid owes nothing; the host owes nothing unless
someone else paid. A participant's account is their `user_id`, or the bill's
`creator_user_id` for a host row without one. Only debts between two
accounts where one is the actor are netted into `balances`. A guest (no
account) owing on a bill the actor collects goes to `unverified` as
`guest_owes_you`; a guest row whose name equals the actor's display name (on
a bill someone else collects) goes there as `name_matches_you`. Name matches
never reach `balances` and never carry handles. `pay_with` is read from the
counterparty's `profiles` row (Venmo, Cash App, PayPal only, never Zelle,
never a bill's own handles) and only when the actor owes; if two
counterparties in the result share a display name (case-insensitive), both
lose `pay_with` and a note says why.

Errors. Unknown or out-of-scope tool: a JSON-RPC error (invalid params,
"Unknown tool"), no audit of the tool name's existence either way beyond
`unknown_tool`. Invalid input, and a bill or group that is unrelated or does
not exist: a tool result with `isError: true` and one identical message per
case ("Bill not found", "Group not found"); nothing written. Every
authenticated `tools/call` writes one audit row (`ok`, `invalid_input`,
`not_found`, `unknown_tool`, `error`) and every authenticated request calls
`touchAgentToken`.

### WP3. Proposed bills, approval, guardrails
Spec D12 (G1, G2, G4), T-INPUT, T-GUARD.
- `create_bill` (`bills:write`): `checkBillInput`, duplicate check (same
  token, same name, items and total within 10 minutes), 20 bills a day per
  account; inserts with `approval_required = true`, `approval_expires_at`
  24 hours out, `created_via = 'agent'`, `agent_token_id`,
  `creator_user_id = actor`, no creator token, host row linked to the actor
  and named from their profile. Returns the bill id, the approval URL, the
  share URL (which works once approved), expiry and warnings. No `group_id`,
  payer, handles or participants in the input. `openWorldHint: true`, no
  `destructiveHint: false`.
- `isPublished` on every ordinary reader: bill GET (id and short code), bill
  PATCH and DELETE, participants POST/PATCH/DELETE, claims POST/DELETE,
  claims batch, the bill page metadata, the Open Graph and Twitter images
  (generic card), `/api/bills/mine`.
- `/api/agent-bills/[id]` GET, approve, decline per the contracts. Declining
  deletes the bill.
- G4: refusals for caps and duplicates, and declines, are audit rows; five
  refusals or three declines by one token within an hour set
  `suspended_at` / `suspended_reason` and email the owner
  (`buildAgentTokenStoppedEmail`). Not-found results never suspend.

### WP4. Screens
Profile "Agent access" section (list, create with code step, the token shown
once with copy and a config snippet, revoke, revoke all, turn a paused token
back on, the warning about shared team connectors); `/approve/[id]`;
`/agent-tokens/revoke`; "Waiting for your approval" on the home page. Follow
the existing screens' visual language (`src/app/profile/page.tsx`,
`src/components/groups/*`, `src/components/create/*`).

### WP5. Review
Adversarial review of the whole diff against the spec, then fixes.
