-- Splittr Migration 004: tip split mode
-- 'proportional' = tip follows what each person ordered (existing behavior)
-- 'even'         = tip divided equally among everyone at the table

ALTER TABLE bills ADD COLUMN IF NOT EXISTS tip_split TEXT NOT NULL DEFAULT 'proportional'
  CHECK (tip_split IN ('proportional', 'even'));
