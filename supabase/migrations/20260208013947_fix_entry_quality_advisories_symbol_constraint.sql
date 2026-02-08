/*
  # Fix Entry Quality Advisories Symbol Constraint

  1. Problem
    - The `entry_quality_advisories` table has a CHECK constraint `symbol ~ '^[A-Z]{6}$'`
    - This only allows exactly 6 uppercase letters (e.g., EURUSD, XAUUSD)
    - Index symbols like NAS100, SPX500, US30 contain digits and vary in length
    - Any advisory for index trades silently fails with a constraint violation

  2. Fix
    - Replace the constraint to allow alphanumeric symbols of 2-10 characters
    - New regex: `'^[A-Z][A-Z0-9]{1,9}$'` (starts with letter, then alphanumeric, 2-10 chars)
    - Covers: EURUSD, XAUUSD, BTCUSD, NAS100, SPX500, US30

  3. Impact
    - No data loss (table currently has zero rows)
    - Backward compatible (all existing valid symbols still pass)
    - Enables Entry Quality Advisor to work for index trades
*/

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'entry_quality_advisories_symbol_check'
    AND table_name = 'entry_quality_advisories'
  ) THEN
    ALTER TABLE entry_quality_advisories
      DROP CONSTRAINT entry_quality_advisories_symbol_check;
  END IF;
END $$;

ALTER TABLE entry_quality_advisories
  ADD CONSTRAINT entry_quality_advisories_symbol_check
  CHECK (symbol ~ '^[A-Z][A-Z0-9]{1,9}$');
