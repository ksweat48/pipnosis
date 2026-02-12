/*
  # Fix ssot_violations NOT NULL columns with defaults

  1. Problem
    - Original columns (symbol, attempted_operation, call_location, blocked, error_details, component) are NOT NULL
    - Trigger functions like enforce_trade_closure_ssot() only provide their own set of columns
    - INSERT fails because NOT NULL columns have no defaults

  2. Fix
    - Add sensible defaults to all NOT NULL columns so partial INSERTs succeed
    - This is non-destructive - existing rows are unaffected
*/

ALTER TABLE ssot_violations ALTER COLUMN symbol SET DEFAULT 'unknown';
ALTER TABLE ssot_violations ALTER COLUMN attempted_operation SET DEFAULT 'unknown';
ALTER TABLE ssot_violations ALTER COLUMN call_location SET DEFAULT 'unknown';
ALTER TABLE ssot_violations ALTER COLUMN blocked SET DEFAULT false;
ALTER TABLE ssot_violations ALTER COLUMN error_details SET DEFAULT '{}'::jsonb;
ALTER TABLE ssot_violations ALTER COLUMN component SET DEFAULT 'unknown';
