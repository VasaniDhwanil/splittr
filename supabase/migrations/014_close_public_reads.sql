-- Splittr Migration 014: clients can't read any table
--
-- APPLY ONLY AFTER the Broadcast doorbell client (commit 26bcbd1) is
-- deployed: older clients subscribe with Postgres Changes, which stops
-- delivering once these reads are gone (their pages still work, just
-- without live updates until reload).
--
-- With realtime on private Broadcast (migration 013), nothing in the
-- browser reads tables. Drop the public read policies and the column grants
-- from 010/011, and take the tables out of the Postgres Changes publication.
-- The anon key can then no longer list bills, guests, items, or claims.

DROP POLICY IF EXISTS "Public read bills" ON public.bills;
DROP POLICY IF EXISTS "Public read bill_items" ON public.bill_items;
DROP POLICY IF EXISTS "Public read participants" ON public.participants;
DROP POLICY IF EXISTS "Public read item_claims" ON public.item_claims;

REVOKE SELECT ON public.bills, public.bill_items, public.participants, public.item_claims
  FROM anon, authenticated;

ALTER PUBLICATION supabase_realtime DROP TABLE public.bills, public.bill_items, public.participants, public.item_claims;
