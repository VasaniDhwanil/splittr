-- Splittr Migration 003: split modes, payments/settle-up, groups

-- ============================================================
-- Fix: item_claims.share was DECIMAL(5,4) CHECK (share <= 1),
-- but the app stores integer quantities (e.g. 2 of 3 beers).
-- ============================================================
ALTER TABLE item_claims DROP CONSTRAINT IF EXISTS item_claims_share_check;
ALTER TABLE item_claims ALTER COLUMN share TYPE DECIMAL(7, 2);
ALTER TABLE item_claims ADD CONSTRAINT item_claims_share_check CHECK (share > 0);

-- ============================================================
-- Split modes: by item (default), evenly, or custom amounts
-- ============================================================
ALTER TABLE bills ADD COLUMN IF NOT EXISTS split_mode TEXT NOT NULL DEFAULT 'items'
  CHECK (split_mode IN ('items', 'even', 'custom'));

-- ============================================================
-- Payments / settle-up
-- ============================================================
ALTER TABLE bills ADD COLUMN IF NOT EXISTS venmo_handle TEXT;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS cashapp_handle TEXT;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS paypal_handle TEXT;

ALTER TABLE participants ADD COLUMN IF NOT EXISTS custom_amount DECIMAL(10, 2);
ALTER TABLE participants ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid'
  CHECK (payment_status IN ('unpaid', 'paid'));
ALTER TABLE participants ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP WITH TIME ZONE;

-- ============================================================
-- Groups: recurring circles (roommates, trips, events)
-- ============================================================
CREATE TABLE IF NOT EXISTS groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '👥',
  creator_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE bills ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_groups_creator_user_id ON groups(creator_user_id);
CREATE INDEX IF NOT EXISTS idx_bills_group_id ON bills(group_id);

ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all access to groups" ON groups;
CREATE POLICY "Allow all access to groups" ON groups FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- Realtime: bill edits and paid-status changes should push live
-- ============================================================
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE bills;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE bill_items;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
