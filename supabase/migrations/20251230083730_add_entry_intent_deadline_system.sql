/*
  # Add Entry Intent Deadline System

  ## Overview
  This migration adds hard deadline enforcement and timeout action fields to the entry_intents table.
  The system now supports:
  - max_wait_seconds: Hard deadline in seconds (not minutes)
  - timeout_action: What to do at deadline (EXECUTE_AT_MARKET or CANCEL)
  - invalidation_price: Price level that invalidates the setup

  ## New Columns
  - `max_wait_seconds` (integer): Maximum wait time in seconds before deadline action
  - `timeout_action` (text): Action to take at deadline ('EXECUTE_AT_MARKET' or 'CANCEL')
  - `invalidation_price` (numeric): Stop loss level that invalidates the setup

  ## Changes
  - Adds three new columns to entry_intents table
  - Sets default values for backwards compatibility
  - All existing intents will default to CANCEL action on timeout

  ## Security
  - No RLS changes needed (existing policies apply)
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'max_wait_seconds'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN max_wait_seconds integer;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'timeout_action'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN timeout_action text DEFAULT 'CANCEL';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'invalidation_price'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN invalidation_price numeric;
  END IF;
END $$;

UPDATE entry_intents
SET max_wait_seconds = timeout_minutes * 60
WHERE max_wait_seconds IS NULL;

ALTER TABLE entry_intents
ALTER COLUMN max_wait_seconds SET DEFAULT 120;

ALTER TABLE entry_intents
ADD CONSTRAINT valid_timeout_action CHECK (timeout_action IN ('EXECUTE_AT_MARKET', 'CANCEL'));

CREATE INDEX IF NOT EXISTS idx_entry_intents_timeout_action ON entry_intents(timeout_action);
CREATE INDEX IF NOT EXISTS idx_entry_intents_max_wait_seconds ON entry_intents(max_wait_seconds);

COMMENT ON COLUMN entry_intents.max_wait_seconds IS 'Hard deadline in seconds for entry monitoring';
COMMENT ON COLUMN entry_intents.timeout_action IS 'Action at deadline: EXECUTE_AT_MARKET or CANCEL';
COMMENT ON COLUMN entry_intents.invalidation_price IS 'Price that invalidates the setup (usually stop loss)';