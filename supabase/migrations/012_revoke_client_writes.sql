-- Splittr Migration 012: the public roles get no write privileges at all
--
-- Since migration 006 every write goes through API routes using the service
-- role, and no RLS policy allows client writes. But Supabase's default
-- grants still gave anon/authenticated INSERT/UPDATE/DELETE/TRUNCATE (and
-- TRUNCATE is not subject to RLS), so RLS was the only barrier. Remove the
-- privileges themselves, plus SELECT on the tables clients never read, and
-- stop future tables from inheriting them.
--
-- Safe to apply with any deployed code: the browser has no direct table
-- access (only Realtime reads, which keep their column-level SELECT).

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.bills, public.bill_items, public.participants, public.item_claims,
     public.profiles, public.groups, public.group_members
  FROM anon, authenticated;

REVOKE SELECT ON public.profiles, public.groups, public.group_members FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon, authenticated;
