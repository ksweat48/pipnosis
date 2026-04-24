/*
  # CCIP-2026-0425A: Hunt Readiness Session Context Columns

  ## Summary
  Adds session context display fields to alpha_hunt_readiness table.
  These fields are informational only — NOT used as gates.

  ## New Columns
  - `session_minutes_remaining` (integer, nullable): Minutes left in current trading session
    when this readiness record was computed. Display only.
  - `estimated_feasible_pips` (numeric, nullable): Estimated price travel possible before
    session ends, based on (remaining_minutes / timeframe_minutes) × ATR_pips.
    Display only — helps traders assess whether there's enough runway.

  ## Security
  No RLS changes — existing policies on alpha_hunt_readiness apply.

  ## Notes
  - Both columns are nullable to allow backfill without breaking existing rows
  - Values are recomputed every 3 minutes by the alpha-hunt-readiness-scanner
  - Session time is NEVER used as a blocking condition per CCIP-2026-0425A governance
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_hunt_readiness'
    AND column_name = 'session_minutes_remaining'
  ) THEN
    ALTER TABLE alpha_hunt_readiness ADD COLUMN session_minutes_remaining integer;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_hunt_readiness'
    AND column_name = 'estimated_feasible_pips'
  ) THEN
    ALTER TABLE alpha_hunt_readiness ADD COLUMN estimated_feasible_pips numeric;
  END IF;
END $$;
