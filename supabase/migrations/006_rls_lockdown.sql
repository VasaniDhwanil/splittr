-- Splittr Migration 006: RLS lockdown
--
-- ⚠️ PREREQUISITE: SUPABASE_SERVICE_ROLE_KEY must be configured in the app's
-- environment (Vercel + .env.local) BEFORE applying this migration. The API
-- routes use the service-role client for all data operations; once this
-- migration runs, the public anon key can no longer write to any table.
--
-- Model after lockdown:
--   - All writes go through API routes (service role bypasses RLS); the
--     routes enforce creator tokens, sessions, and group membership.
--   - bills / bill_items / participants / item_claims stay publicly READABLE:
--     bills are share-by-link, and Supabase Realtime needs SELECT to deliver
--     change events to the bill page.
--   - profiles / groups / group_members have no client policies at all —
--     payment handles and memberships are only reachable through the API.

-- Drop the permissive MVP policies
DROP POLICY IF EXISTS "Allow all access to bills" ON bills;
DROP POLICY IF EXISTS "Allow all access to bill_items" ON bill_items;
DROP POLICY IF EXISTS "Allow all access to participants" ON participants;
DROP POLICY IF EXISTS "Allow all access to item_claims" ON item_claims;
DROP POLICY IF EXISTS "Allow all access to profiles" ON profiles;
DROP POLICY IF EXISTS "Allow all access to groups" ON groups;
DROP POLICY IF EXISTS "Allow all access to group_members" ON group_members;

-- Read-only access where link-sharing and realtime require it
CREATE POLICY "Public read bills" ON bills FOR SELECT USING (true);
CREATE POLICY "Public read bill_items" ON bill_items FOR SELECT USING (true);
CREATE POLICY "Public read participants" ON participants FOR SELECT USING (true);
CREATE POLICY "Public read item_claims" ON item_claims FOR SELECT USING (true);

-- profiles / groups / group_members: deny-by-default (no policies).
-- RLS is already enabled on all tables; absence of policies means the anon
-- and authenticated roles can neither read nor write them directly.
