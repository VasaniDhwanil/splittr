-- The split sheet writes exact per-head fractions (⅔ -> 0.6667, 1/12 ->
-- 0.0833). At numeric(7,2) those rounded to 0.67 / 0.08, drifting a 12-way
-- split's total to 0.96 and breaking "fully claimed" detection. Four decimal
-- places keep a 50-person split's total within 0.005 of the true quantity.
ALTER TABLE item_claims ALTER COLUMN share TYPE numeric(9,4);
