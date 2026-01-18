/*
  # Fix Position Size CHECK Constraint for Closed Trades

  ## Problem
  The `valid_position_size_range` CHECK constraint blocks closure of trades where
  position_size falls below 0.001 lots (e.g., after TP1 partial close).

  The trigger-based exemption (migration 20260118060803) only exempts the TRIGGER,
  but the table-level CHECK CONSTRAINT still blocks the UPDATE.

  ## Root Cause
  - Table has CHECK constraint: position_size >= 0.001 AND position_size <= 1000
  - This constraint runs on EVERY UPDATE, even when closing trades
  - Constraint doesn't have logic to exempt closed trades
  - User cannot close position even with force_close=true

  ## Solution
  Replace the CHECK constraint with one that exempts closed trades:
  - Keep validation for open/pending/soft_closing trades
  - Allow any position_size value when status = 'closed'

  ## Changes
  1. Drop existing valid_position_size_range constraint
  2. Add new constraint that exempts closed trades from position_size validation
*/

-- Drop the existing constraint
ALTER TABLE goal_session_trades DROP CONSTRAINT IF EXISTS valid_position_size_range;

-- Add new constraint that exempts closed trades
ALTER TABLE goal_session_trades ADD CONSTRAINT valid_position_size_range
CHECK (
  -- Closed trades are exempt from position_size validation
  status = 'closed'
  OR
  -- Active trades must meet position_size requirements
  (position_size >= 0.001 AND position_size <= 1000)
);

-- Verification
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '  Position Size Constraint Fixed for Trade Closure';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE '  ✅ CHECK constraint now exempts closed trades';
  RAISE NOTICE '  ✅ Trades can close regardless of position_size value';
  RAISE NOTICE '  ✅ Active trades still enforced: 0.001 <= position_size <= 1000';
  RAISE NOTICE '';
  RAISE NOTICE '  This complements the trigger exemption from migration 20260118060803';
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
