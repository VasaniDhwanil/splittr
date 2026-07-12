# Splittr

Split bills effortlessly. Scan a receipt, share a link, everyone picks what they ordered — no app download, no forced signup.

## Features

- **AI receipt scanning** — photograph or upload a receipt; Claude Vision extracts items, quantities, prices, and tax automatically. Manual entry and "just split a total" also supported.
- **Three split modes**
  - **By item** — everyone taps what they ordered; shared items split automatically, multi-quantity items support per-unit claiming.
  - **Evenly** — the total divided equally among participants.
  - **Custom amounts** — the host assigns each person their share.
- **Fair tax & tip** — split proportionally to what each person ordered (item mode) or equally (even mode).
- **Settle up** — the host adds Venmo / Cash App / PayPal handles; everyone gets one-tap payment links for their exact share, marks themselves paid, and the host sees a payment progress bar.
- **Groups** — signed-in users can group bills (roommates, trips, events) and see running balances per person across all bills in the group.
- **Bill management** — hosts can edit items/tax/tip/split mode/payment handles after creation, mark bills settled, and delete bills.
- **Real-time** — claims, joins, edits, and payments update live via Supabase Realtime.
- **Progressive auth** — everything works anonymously (creator tokens in localStorage); sign in with a magic link to access bills from any device and unlock groups.

## Stack

- [Next.js 16](https://nextjs.org) (App Router) + React 19 + TypeScript
- [Supabase](https://supabase.com) — Postgres, Auth (magic links), Realtime
- [Anthropic API](https://docs.anthropic.com) — Claude Vision receipt scanning
- Tailwind CSS v4 + shadcn/ui

## Setup

1. **Install dependencies** (Node 20+):

   ```bash
   npm install
   ```

2. **Environment** — create `.env.local`:

   ```
   NEXT_PUBLIC_SUPABASE_URL=<your supabase project url>
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<your supabase anon key>
   SUPABASE_SERVICE_ROLE_KEY=<your supabase service_role key — server-only, required once migration 006 is applied>
   ANTHROPIC_API_KEY=<your anthropic api key>
   ```

3. **Database** — run the migrations in `supabase/migrations/` in order (via the Supabase SQL editor or CLI):

   - `001_initial_schema.sql` — bills, items, participants, claims
   - `002_progressive_auth.sql` — creator tokens + account linking
   - `003_split_modes_payments_groups.sql` — split modes, payments/settle-up, groups

4. **Run**:

   ```bash
   npm run dev
   ```

## How it works

1. **Create** — scan a receipt (or enter items / a total), pick a split mode, optionally add payment handles and a group.
2. **Share** — send the link or 6-character code to the table.
3. **Claim** — everyone joins with just a name and taps their items (item mode), or sees their equal/assigned share.
4. **Settle** — each person pays via the one-tap links and marks themselves paid; the host tracks progress and marks the bill settled.
