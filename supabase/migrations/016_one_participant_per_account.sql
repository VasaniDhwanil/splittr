-- Splittr Migration 016: an account has at most one participant row per bill
--
-- POST /api/participants dedupes signed-in joins with a read followed by an
-- insert, so two joins that race could both insert. "My row on this bill"
-- then has two answers, which matters once balances and agent tools are
-- computed per account.
--
-- This merges any existing duplicates into one row (claims and paid status
-- are kept, nothing is dropped) and then makes duplicates impossible.
--
-- APPLY AFTER the code deploy that handles the unique violation in
-- POST /api/participants (it returns the row the winning join created).
-- Older code would answer a lost race with a 500.

-- Folds every extra row an account has on a bill into one survivor: the host
-- row when there is one, otherwise the oldest. Returns how many rows it
-- removed.
CREATE OR REPLACE FUNCTION public.merge_duplicate_participants()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  pair RECORD;
  removed INTEGER := 0;
BEGIN
  FOR pair IN
    SELECT keep.id AS survivor, extra.id AS duplicate
    FROM (
      SELECT DISTINCT ON (bill_id, user_id) id, bill_id, user_id
      FROM public.participants
      WHERE user_id IS NOT NULL
      ORDER BY bill_id, user_id, is_creator DESC, created_at ASC, id ASC
    ) keep
    JOIN public.participants extra
      ON extra.bill_id = keep.bill_id
     AND extra.user_id = keep.user_id
     AND extra.id <> keep.id
  LOOP
    -- Same item claimed on both rows: one claim survives, with the larger share
    UPDATE public.item_claims mine
    SET share = GREATEST(mine.share, theirs.share)
    FROM public.item_claims theirs
    WHERE mine.participant_id = pair.survivor
      AND theirs.participant_id = pair.duplicate
      AND theirs.item_id = mine.item_id;

    DELETE FROM public.item_claims theirs
    USING public.item_claims mine
    WHERE theirs.participant_id = pair.duplicate
      AND mine.participant_id = pair.survivor
      AND mine.item_id = theirs.item_id;

    UPDATE public.item_claims SET participant_id = pair.survivor
    WHERE participant_id = pair.duplicate;

    -- Paid on either row means paid; keep an assigned amount and a device
    -- token if only the duplicate had one
    UPDATE public.participants keep
    SET payment_status = CASE WHEN extra.payment_status = 'paid' THEN 'paid' ELSE keep.payment_status END,
        paid_at = COALESCE(keep.paid_at, extra.paid_at),
        custom_amount = COALESCE(keep.custom_amount, extra.custom_amount),
        participant_token_hash = COALESCE(keep.participant_token_hash, extra.participant_token_hash)
    FROM public.participants extra
    WHERE keep.id = pair.survivor AND extra.id = pair.duplicate;

    DELETE FROM public.participants WHERE id = pair.duplicate;
    removed := removed + 1;
  END LOOP;
  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_duplicate_participants() FROM PUBLIC, anon, authenticated;

SELECT public.merge_duplicate_participants();

CREATE UNIQUE INDEX IF NOT EXISTS participants_bill_user_unique
  ON public.participants (bill_id, user_id)
  WHERE user_id IS NOT NULL;
