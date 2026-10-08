-- Splittr Migration 011: per-participant secret for "mark me paid"
--
-- PATCH /api/participants let anyone flip anyone's payment_status. Each
-- participant now gets a secret at join time (returned once, kept in the
-- joiner's browser, sent as X-Participant-Token). Only its SHA-256 hash is
-- stored. Rows created before this migration have no hash; their payment
-- status can be changed by the bill creator or the participant's own
-- signed-in account.
--
-- Clients must never read the hash: column-level SELECT like bills
-- (migration 010). Safe to apply before or after the code deploy: no
-- client reads participants directly, and the API uses the service role.

ALTER TABLE participants ADD COLUMN IF NOT EXISTS participant_token_hash TEXT;

REVOKE SELECT ON public.participants FROM anon, authenticated;
GRANT SELECT (
  id, bill_id, user_id, name, is_creator, created_at, custom_amount,
  payment_status, paid_at
) ON public.participants TO anon, authenticated;
