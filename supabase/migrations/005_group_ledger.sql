-- Splittr Migration 005: payment profiles, group membership, invites
-- Enables Splitwise-style groups: members join by invite, payment handles
-- live on the person (profile), and balances net across bills.

-- ============================================================
-- Profiles: one per auth user — display name + payment handles
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  venmo_handle TEXT,
  cashapp_handle TEXT,
  paypal_handle TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all access to profiles" ON profiles;
CREATE POLICY "Allow all access to profiles" ON profiles FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- Group membership + invite codes
-- ============================================================
ALTER TABLE groups ADD COLUMN IF NOT EXISTS invite_code TEXT UNIQUE;

-- Backfill invite codes for existing groups (random, link-clicked not typed)
UPDATE groups
SET invite_code = upper(substr(md5(random()::text || id::text), 1, 8))
WHERE invite_code IS NULL;

CREATE TABLE IF NOT EXISTS group_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user_id ON group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_groups_invite_code ON groups(invite_code);
CREATE INDEX IF NOT EXISTS idx_participants_user_id ON participants(user_id);

ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all access to group_members" ON group_members;
CREATE POLICY "Allow all access to group_members" ON group_members FOR ALL USING (true) WITH CHECK (true);

-- Existing group creators become owner members
INSERT INTO group_members (group_id, user_id, display_name, role)
SELECT g.id, g.creator_user_id, COALESCE(p.display_name, 'Host'), 'owner'
FROM groups g
LEFT JOIN profiles p ON p.user_id = g.creator_user_id
ON CONFLICT (group_id, user_id) DO NOTHING;
