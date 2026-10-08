-- Splittr Migration 013: realtime "doorbell" via Broadcast
--
-- Bill pages used Postgres Changes, which only delivers rows the listener
-- can SELECT, so bills/participants/bill_items/item_claims had to be
-- publicly readable, and anyone with the anon key could list every bill.
--
-- Instead, a trigger on each table broadcasts `changed` with ONLY
-- { table, bill_id } on the private topic bill:<bill id>. Clients refetch
-- through the API. Guests (no account) may LISTEN on bill:* topics: the
-- bill id is the share-link secret, same as the URL. Nobody may SEND from a
-- client (no INSERT policy), so doorbells can't be spoofed.
--
-- Additive: existing Postgres Changes subscribers keep working until
-- migration 014 removes table reads (after this client ships).

CREATE OR REPLACE FUNCTION public.ring_bill_doorbell()
RETURNS trigger
LANGUAGE plpgsql
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

DROP TRIGGER IF EXISTS ring_bill_doorbell ON public.bills;
CREATE TRIGGER ring_bill_doorbell AFTER INSERT OR UPDATE OR DELETE ON public.bills
  FOR EACH ROW EXECUTE FUNCTION public.ring_bill_doorbell();
DROP TRIGGER IF EXISTS ring_bill_doorbell ON public.participants;
CREATE TRIGGER ring_bill_doorbell AFTER INSERT OR UPDATE OR DELETE ON public.participants
  FOR EACH ROW EXECUTE FUNCTION public.ring_bill_doorbell();
DROP TRIGGER IF EXISTS ring_bill_doorbell ON public.bill_items;
CREATE TRIGGER ring_bill_doorbell AFTER INSERT OR UPDATE OR DELETE ON public.bill_items
  FOR EACH ROW EXECUTE FUNCTION public.ring_bill_doorbell();
DROP TRIGGER IF EXISTS ring_bill_doorbell ON public.item_claims;
CREATE TRIGGER ring_bill_doorbell AFTER INSERT OR UPDATE OR DELETE ON public.item_claims
  FOR EACH ROW EXECUTE FUNCTION public.ring_bill_doorbell();

-- Clients can't call the trigger function directly
REVOKE ALL ON FUNCTION public.ring_bill_doorbell() FROM PUBLIC, anon, authenticated;

-- Listen-only access to bill doorbells for guests and signed-in users
DROP POLICY IF EXISTS "Listen to bill doorbells" ON realtime.messages;
CREATE POLICY "Listen to bill doorbells" ON realtime.messages
  FOR SELECT TO anon, authenticated
  USING (
    realtime.messages.extension = 'broadcast'
    AND realtime.topic() ~ '^bill:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );
