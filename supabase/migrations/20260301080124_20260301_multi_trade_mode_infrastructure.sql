/*
  # Multi-Trade Mode Infrastructure

  ## Summary
  Establishes the database-level SSOT for multi-trade session configuration.

  ## Changes

  ### Modified Tables
  - `goal_sessions`
    - `max_concurrent_trades` (integer, default 1) — SSOT for how many trades
      Alpha is authorised to hold simultaneously in this session. When multi-trade
      mode is enabled at session creation this is set to 3. Single-trade sessions
      remain at 1. The trade executor reads this value instead of inferring from
      risk_mode, making the intent explicit and auditable.

  ## Governance
  - Column default of 1 preserves all existing session behaviour (no breaking change).
  - Value is written once at session creation (immutable after that).
  - CHECK constraint enforces 1–3 range — values outside this are rejected at DB level.

  ## Notes
  1. Existing sessions automatically get max_concurrent_trades = 1 via DEFAULT.
  2. No data migration needed — the default covers all historical rows.
  3. RLS is unchanged; the column inherits existing goal_sessions policies.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions'
      AND column_name = 'max_concurrent_trades'
  ) THEN
    ALTER TABLE goal_sessions
      ADD COLUMN max_concurrent_trades integer NOT NULL DEFAULT 1
        CHECK (max_concurrent_trades BETWEEN 1 AND 3);
  END IF;
END $$;

COMMENT ON COLUMN goal_sessions.max_concurrent_trades IS
  'SSOT: maximum simultaneous open trades allowed for this session. '
  '1 = single-trade mode (default), 2-3 = multi-trade mode. '
  'Set once at session creation and treated as immutable thereafter.';
