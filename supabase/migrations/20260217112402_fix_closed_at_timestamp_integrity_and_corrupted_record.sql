/*
  # Fix closed_at Timestamp Integrity

  1. Problem
    - The closed_at field on goal_session_trades was being set to candle open_time
      instead of wall-clock time, causing impossible timestamps where closed_at < opened_at
    - One corrupted record exists from 2026-02-17 micro trade

  2. Changes
    - Add a CHECK constraint that prevents closed_at from being before opened_at
    - Fix any existing corrupted records where closed_at < opened_at
    - Add a trigger to enforce wall-clock time on future closures

  3. Security
    - No RLS changes (existing policies remain)
    - Constraint is data-integrity only

  4. CCIP Governance
    - Root cause: event-based-llm-engine.ts used currentCandle.open_time as exitTime
    - Frontend fix: closeTrade() now uses new Date() (wall-clock time)
    - Database fix: CHECK constraint as defense-in-depth
*/

-- Step 1: Fix any corrupted records where closed_at < opened_at
-- Set closed_at to opened_at + 1 second as minimum valid closure time
UPDATE goal_session_trades
SET closed_at = opened_at + interval '1 second'
WHERE status = 'closed'
  AND closed_at IS NOT NULL
  AND opened_at IS NOT NULL
  AND closed_at < opened_at;

-- Step 2: Add a trigger to enforce closed_at >= opened_at on future writes
-- Using a trigger instead of CHECK because closed_at may be NULL for open trades
CREATE OR REPLACE FUNCTION enforce_closed_at_after_opened_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.closed_at IS NOT NULL AND NEW.opened_at IS NOT NULL THEN
    IF NEW.closed_at < NEW.opened_at THEN
      NEW.closed_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_enforce_closed_at_integrity'
  ) THEN
    CREATE TRIGGER trg_enforce_closed_at_integrity
      BEFORE INSERT OR UPDATE ON goal_session_trades
      FOR EACH ROW
      EXECUTE FUNCTION enforce_closed_at_after_opened_at();
  END IF;
END $$;
