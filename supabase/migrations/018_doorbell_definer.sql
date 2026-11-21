-- Splittr Migration 018: let account deletion run the bill doorbell
--
-- Deleting an auth user cascades into public.bills: creator_user_id and
-- paid_by_user_id are ON DELETE SET NULL (and a deleted group detaches its
-- bills the same way). That UPDATE fires the ring_bill_doorbell trigger, whose
-- function calls realtime.send(). The function was SECURITY INVOKER, so it ran
-- as whoever deleted the user. From the Supabase dashboard or the auth admin
-- API that is supabase_auth_admin, which has no USAGE on schema realtime, so
-- the deletion failed with "Database error deleting user" for every account
-- that had created a bill or paid for one.
--
-- Fix: make the function SECURITY DEFINER (owner postgres), so it is the one
-- thing that crosses into the realtime schema. supabase_auth_admin is
-- deliberately NOT granted anything on realtime. EXECUTE stays revoked from
-- PUBLIC, anon and authenticated, so clients still cannot call it; triggers
-- run it regardless of the caller's EXECUTE right. search_path stays '' and
-- the body is unchanged.
--
-- This was the only trigger on the deletion cascade that needed it:
-- log_group_membership (015) is already SECURITY DEFINER, and no other
-- trigger exists on the tables auth.users cascades into.
--
-- Safe to apply at any time: it changes no data and no behaviour for app
-- requests, which run as the service role and ring the doorbell exactly as
-- before.

CREATE OR REPLACE FUNCTION public.ring_bill_doorbell()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  row_data jsonb;
  target uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    row_data := to_jsonb(OLD);
  ELSE
    row_data := to_jsonb(NEW);
  END IF;

  IF TG_TABLE_NAME = 'bills' THEN
    target := (row_data->>'id')::uuid;
  ELSIF TG_TABLE_NAME = 'item_claims' THEN
    -- No bill_id on claims. When a claim is cascade-deleted with its item
    -- or participant, one parent may already be gone; the other usually
    -- isn't, and the parent's own trigger rings regardless.
    SELECT bi.bill_id INTO target FROM public.bill_items bi WHERE bi.id = (row_data->>'item_id')::uuid;
    IF target IS NULL THEN
      SELECT p.bill_id INTO target FROM public.participants p WHERE p.id = (row_data->>'participant_id')::uuid;
    END IF;
  ELSE
    target := (row_data->>'bill_id')::uuid;
  END IF;

  IF target IS NOT NULL THEN
    PERFORM realtime.send(
      jsonb_build_object('table', TG_TABLE_NAME, 'bill_id', target),
      'changed',
      'bill:' || target::text,
      true
    );
  END IF;
  RETURN NULL;
END;
$$;

ALTER FUNCTION public.ring_bill_doorbell() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.ring_bill_doorbell() FROM PUBLIC, anon, authenticated;
