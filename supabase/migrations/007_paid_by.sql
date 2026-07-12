-- Splittr Migration 007: separate "who paid" from "who created"
--
-- paid_by_user_id records whose money covered the bill (the Splitwise
-- "paid by" concept). NULL means the creator paid — the behavior all
-- existing bills keep. Only meaningful for group bills, where the payer
-- must be a group member; the API enforces that.

ALTER TABLE bills ADD COLUMN IF NOT EXISTS paid_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bills_paid_by_user_id ON bills(paid_by_user_id);
