-- Splittr Migration 015: group membership history + audit of group bills
--
-- Until the fix that ships with this migration, PATCH /api/bills/[id] let any
-- bill owner (including an anonymous creator-token holder) set group_id to a
-- group they were not in, which put debts in that group's ledger. The route
-- now requires a signed-in member. This migration covers what the route
-- can't: which bills were filed that way before.
--
-- Leaving a group deletes the group_members row, so "was this person ever a
-- member" has had no answer. From here on, every join and leave is logged.
-- The log is backfilled from today's members; anyone who left before this
-- migration is unknown to it, which is why the audit below only lists
-- suspects for a human to look at instead of detaching them.
--
-- Safe to apply before or after the code deploy: nothing in the app reads
-- these tables.

CREATE TABLE IF NOT EXISTS public.group_membership_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event TEXT NOT NULL CHECK (event IN ('joined', 'left')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_group_membership_events_group_user
  ON public.group_membership_events(group_id, user_id);

ALTER TABLE public.group_membership_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.group_membership_events FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.log_group_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.group_membership_events (group_id, user_id, event)
    VALUES (NEW.group_id, NEW.user_id, 'joined');
  ELSIF EXISTS (SELECT 1 FROM public.groups g WHERE g.id = OLD.group_id)
    AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = OLD.user_id) THEN
    -- Not when the group or the account itself is being deleted: the member
    -- row is going away with its parent, and so is the history
    INSERT INTO public.group_membership_events (group_id, user_id, event)
    VALUES (OLD.group_id, OLD.user_id, 'left');
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.log_group_membership() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS log_group_membership ON public.group_members;
CREATE TRIGGER log_group_membership AFTER INSERT OR DELETE ON public.group_members
  FOR EACH ROW EXECUTE FUNCTION public.log_group_membership();

INSERT INTO public.group_membership_events (group_id, user_id, event, created_at)
SELECT m.group_id, m.user_id, 'joined', COALESCE(m.created_at, NOW())
FROM public.group_members m
WHERE NOT EXISTS (
  SELECT 1 FROM public.group_membership_events e
  WHERE e.group_id = m.group_id AND e.user_id = m.user_id
);

-- Group bills whose creator has no recorded membership of that group.
CREATE TABLE IF NOT EXISTS public.group_bill_review (
  bill_id UUID PRIMARY KEY REFERENCES public.bills(id) ON DELETE CASCADE,
  group_id UUID NOT NULL,
  reason TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('review', 'detached')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

ALTER TABLE public.group_bill_review ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.group_bill_review FROM PUBLIC, anon, authenticated;

-- Lists every group bill whose creator is unknown or was never recorded as a
-- member. With detach_impossible, also removes from its group any such bill
-- that is older than the group: before this migration there was no
-- legitimate way to file an existing bill into a group, so those can only
-- have come through the hole. Everything else stays where it is.
CREATE OR REPLACE FUNCTION public.audit_group_bills(detach_impossible BOOLEAN DEFAULT FALSE)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  suspect RECORD;
  found INTEGER := 0;
BEGIN
  FOR suspect IN
    SELECT b.id AS bill_id,
           b.group_id,
           b.creator_user_id IS NULL AS anonymous,
           b.created_at < g.created_at AS predates_group
    FROM public.bills b
    JOIN public.groups g ON g.id = b.group_id
    WHERE b.creator_user_id IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM public.group_membership_events e
         WHERE e.group_id = b.group_id AND e.user_id = b.creator_user_id
       )
  LOOP
    found := found + 1;
    IF detach_impossible AND suspect.predates_group THEN
      UPDATE public.bills SET group_id = NULL, paid_by_user_id = NULL WHERE id = suspect.bill_id;
      INSERT INTO public.group_bill_review (bill_id, group_id, reason, action)
      VALUES (suspect.bill_id, suspect.group_id, 'bill is older than the group it was filed in', 'detached')
      ON CONFLICT (bill_id) DO UPDATE SET action = 'detached', reason = EXCLUDED.reason;
    ELSE
      INSERT INTO public.group_bill_review (bill_id, group_id, reason, action)
      VALUES (
        suspect.bill_id,
        suspect.group_id,
        CASE WHEN suspect.anonymous THEN 'bill has no creator account'
             ELSE 'creator has no recorded membership of the group' END,
        'review'
      )
      ON CONFLICT (bill_id) DO NOTHING;
    END IF;
  END LOOP;
  RETURN found;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_group_bills(BOOLEAN) FROM PUBLIC, anon, authenticated;

SELECT public.audit_group_bills(TRUE);
