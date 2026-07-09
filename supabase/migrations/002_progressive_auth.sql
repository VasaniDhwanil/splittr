ALTER TABLE bills ADD COLUMN creator_token TEXT;
ALTER TABLE bills ADD COLUMN creator_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX idx_bills_creator_user_id ON bills(creator_user_id);
CREATE INDEX idx_bills_creator_token ON bills(creator_token);
