-- Splittr Database Schema
-- Run this in your Supabase SQL editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Bills table
CREATE TABLE bills (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  subtotal DECIMAL(10, 2) NOT NULL DEFAULT 0,
  tax DECIMAL(10, 2) NOT NULL DEFAULT 0,
  tip_percent DECIMAL(5, 2) NOT NULL DEFAULT 0,
  tip_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'settled')),
  short_code TEXT UNIQUE NOT NULL,
  creator_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Bill items table
CREATE TABLE bill_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Participants table
CREATE TABLE participants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  user_id UUID,
  name TEXT NOT NULL,
  is_creator BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Item claims table (who ordered what)
CREATE TABLE item_claims (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES bill_items(id) ON DELETE CASCADE,
  share DECIMAL(5, 4) NOT NULL DEFAULT 1.0 CHECK (share > 0 AND share <= 1),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(participant_id, item_id)
);

-- Indexes for performance
CREATE INDEX idx_bill_items_bill_id ON bill_items(bill_id);
CREATE INDEX idx_participants_bill_id ON participants(bill_id);
CREATE INDEX idx_item_claims_participant_id ON item_claims(participant_id);
CREATE INDEX idx_item_claims_item_id ON item_claims(item_id);
CREATE INDEX idx_bills_short_code ON bills(short_code);

-- Row Level Security (RLS)
ALTER TABLE bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE bill_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_claims ENABLE ROW LEVEL SECURITY;

-- Policies: Allow all operations for now (no auth required for MVP)
-- Bills
CREATE POLICY "Allow all access to bills" ON bills FOR ALL USING (true) WITH CHECK (true);

-- Bill items
CREATE POLICY "Allow all access to bill_items" ON bill_items FOR ALL USING (true) WITH CHECK (true);

-- Participants
CREATE POLICY "Allow all access to participants" ON participants FOR ALL USING (true) WITH CHECK (true);

-- Item claims
CREATE POLICY "Allow all access to item_claims" ON item_claims FOR ALL USING (true) WITH CHECK (true);

-- Enable realtime for relevant tables
ALTER PUBLICATION supabase_realtime ADD TABLE participants;
ALTER PUBLICATION supabase_realtime ADD TABLE item_claims;
