-- Splittr Migration 010: clients can no longer read bills.creator_token
--
-- creator_token is the bill's edit key. bills stays publicly readable (share
-- links + Realtime), but the "Public read bills" policy exposed every
-- column, so the anon key could list every bill's token, and Realtime
-- UPDATE payloads carried it too.
--
-- Column-level SELECT: anon/authenticated keep every column EXCEPT
-- creator_token. Realtime drops columns the subscriber can't select, so
-- change events still arrive, just without the token. The API reads it with
-- the service role (requireBillOwnership), which is unaffected.
--
-- ⚠️ Adding a column to bills? Clients won't see it until you also run:
--   GRANT SELECT (<new_column>) ON public.bills TO anon, authenticated;
-- (only needed if the browser reads it directly; API routes use the
-- service role). scripts/token-exposure-test.sh checks this.

REVOKE SELECT ON public.bills FROM anon, authenticated;

GRANT SELECT (
  id, name, date, subtotal, tax, tip_percent, tip_amount, status, short_code,
  creator_id, created_at, creator_user_id, split_mode, venmo_handle,
  cashapp_handle, paypal_handle, group_id, tip_split, paid_by_user_id,
  zelle_handle
) ON public.bills TO anon, authenticated;
