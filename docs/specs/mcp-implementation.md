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

**Phase 0 and the harness are committed** (WP0, commits `e95c8c4`..`417184d`:
33 server tests, 120 unit tests, type-check, lint and build all pass). The
feature rows below are still uncommitted work for WP1.

| Area | Files | State |
|---|---|---|
| Test harness | `vitest.server.config.ts`, `tests/server/global-setup.ts`, `tests/server/setup-env.ts`, `tests/server/helpers/*`, `supabase/config.toml`, `package.json` scripts (`test:server`, `db:start`, `db:stop`, `db:reset`), `pg` devDependency | committed |
| P1 group filing | `src/app/api/bills/[id]/route.ts` (PATCH), `supabase/migrations/015_group_membership_history.sql`, `tests/server/phase0-group-filing.test.ts` | committed |
| P2 claims auth | `canEditClaims` in `src/lib/auth-helpers.ts`, `src/app/api/claims/route.ts`, `src/app/api/claims/batch/route.ts`, client in `src/app/bill/[id]/page.tsx`, `scripts/api-scenario-test.sh`, `scripts/realtime-doorbell-probe.mjs`, `e2e/realtime.spec.ts`, `tests/server/phase0-claims-auth.test.ts` | committed |
| P4 one row per account | `src/app/api/bills/claim/route.ts`, `src/app/api/participants/route.ts` (23505 handling), `supabase/migrations/016_one_participant_per_account.sql`, claim prompt copy in `src/app/page.tsx`, `tests/server/phase0-participant-identity.test.ts` | committed |
| P5 bill privacy | GET in `src/app/api/bills/[id]/route.ts`, `publicBill` / `memberBill` in `src/lib/auth-helpers.ts`, `src/types/index.ts`, payer logic in `src/app/bill/[id]/page.tsx`, `tests/server/phase0-bill-privacy.test.ts` | committed |
| Proxy | `src/middleware.ts` renamed to `src/proxy.ts` (Next 16), `/api/mcp` excluded from the matcher, `tests/server/proxy-matcher.test.ts` | committed |
| Feature, pure logic | `src/lib/agent-tokens.ts`, `src/lib/mcp/sanitize.ts`, `src/lib/mcp/guardrails.ts`, `tests/unit/agent-tokens.test.ts`, `tests/unit/mcp-sanitize.test.ts`, `tests/unit/mcp-guardrails.test.ts` | done, 26 tests green |
| Feature, schema | `supabase/migrations/017_agent_access.sql` | applies cleanly on a fresh local stack; functions untested |
| Feature, email | `src/lib/agent-emails.ts` (`buildAgentCodeEmail`, `buildAgentTokenCreatedEmail`, `buildAgentTokenStoppedEmail`); `emailShell` and `escapeHtml` exported from `src/lib/email.ts` | written, untested |
| Dependencies | `@modelcontextprotocol/sdk@1.32.2`, `zod@4.3.5` in `package.json` | installed |

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
