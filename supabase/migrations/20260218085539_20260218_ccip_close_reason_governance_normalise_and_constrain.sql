/*
  # CCIP Close Reason Governance - Normalise Legacy Values and Add CHECK Constraint

  ## Purpose
  This migration enforces the CloseReason SSOT (defined in src/types/position.ts) at the
  database layer. Without a CHECK constraint, any string can be written to close_reason,
  creating a silent divergence between the TypeScript type system and the stored data.

  ## Changes Made

  ### 1. Data Normalisation (BEFORE constraint)
  Backfills legacy / non-standard close_reason values found in the live database:
  - 'user_stopped' → 'manual'   (7 rows)
  - 'timeout'      → 'session_ended' (2 rows)

  These are the only non-SSOT values found via audit of the live table.

  ### 2. CHECK Constraint on goal_session_trades.close_reason
  Enforces that only CloseReason union members may be stored. This closes the gap where
  the TypeScript type could be bypassed by direct DB writes or RPC functions.

  ### Allowed Values (mirrors CloseReason in src/types/position.ts)
  manual | stop_loss | take_profit | take_profit_1 | take_profit_2 |
  goal_achieved | goal_expired | session_ended | risk_limit |
  trailing_stop | weekend_protection | holiday_closure | force_closed | market_closed

  ### Security / RLS
  No RLS changes - this is a schema governance migration only.

  ### Rollback Notes
  To rollback: DROP CONSTRAINT goal_session_trades_close_reason_check
  Then un-normalise if needed (values were 'user_stopped' and 'timeout').
*/

-- Step 1: Normalise legacy values BEFORE adding the constraint
UPDATE goal_session_trades
SET close_reason = 'manual'
WHERE close_reason = 'user_stopped';

UPDATE goal_session_trades
SET close_reason = 'session_ended'
WHERE close_reason = 'timeout';

-- Step 2: Add CHECK constraint enforcing the CloseReason SSOT
-- Using IF NOT EXISTS pattern via DO block for idempotency
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'goal_session_trades'
      AND constraint_name = 'goal_session_trades_close_reason_check'
  ) THEN
    ALTER TABLE goal_session_trades
      ADD CONSTRAINT goal_session_trades_close_reason_check
      CHECK (
        close_reason IS NULL OR close_reason IN (
          'manual',
          'stop_loss',
          'take_profit',
          'take_profit_1',
          'take_profit_2',
          'goal_achieved',
          'goal_expired',
          'session_ended',
          'risk_limit',
          'trailing_stop',
          'weekend_protection',
          'holiday_closure',
          'force_closed',
          'market_closed'
        )
      );
  END IF;
END $$;
