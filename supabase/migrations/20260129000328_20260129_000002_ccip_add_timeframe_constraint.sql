/*
  # CCIP Compliance: Add Timeframe Constraint

  Enforces that goal_sessions.timeframe ONLY contains valid canonical values.
  Prevents future insertions of invalid timeframes.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'goal_sessions' AND constraint_name = 'valid_timeframe'
  ) THEN
    ALTER TABLE goal_sessions
    ADD CONSTRAINT valid_timeframe
    CHECK (timeframe IN ('M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'));

    RAISE NOTICE 'Added CCIP timeframe constraint to goal_sessions - all future timeframes must be canonical format';
  ELSE
    RAISE NOTICE 'Timeframe constraint already exists on goal_sessions';
  END IF;
END $$;
