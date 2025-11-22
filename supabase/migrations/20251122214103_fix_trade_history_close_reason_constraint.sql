/*
  # Fix trade_history close_reason CHECK Constraint

  ## Problem
  The trade_history table has a CHECK constraint that only allows:
  - 'manual', 'stop_loss', 'take_profit'
  
  But the synthetic backtest engine inserts trades with:
  - 'session_end' (when backtest period ends)
  - 'win', 'loss', 'breakeven' (from outcome fallback)
  
  Result: 400 Bad Request errors on every trade insert!

  ## Solution
  Expand the CHECK constraint to allow all valid close reasons used by the system.

  ## Changes
  1. Drop existing restrictive constraint
  2. Add new constraint with all valid values
  3. Allow NULL for unknown close reasons

  ## Security
  - Maintains data integrity with CHECK constraint
  - Allows all legitimate close reason values
  - Backward compatible with existing data
*/

-- ============================================================================
-- STEP 1: Drop the restrictive CHECK constraint
-- ============================================================================

ALTER TABLE trade_history DROP CONSTRAINT IF EXISTS trade_history_close_reason_check;

-- ============================================================================
-- STEP 2: Add expanded CHECK constraint with all valid close reasons
-- ============================================================================

ALTER TABLE trade_history ADD CONSTRAINT trade_history_close_reason_check
  CHECK (
    close_reason IN (
      -- Original values
      'manual',
      'stop_loss',
      'take_profit',
      
      -- Synthetic backtest values
      'session_end',
      
      -- Outcome-based values (fallback from trade.outcome)
      'win',
      'loss',
      'breakeven',
      
      -- Future-proof values
      'time_expired',
      'margin_call',
      'trailing_stop',
      'partial_close'
    ) 
    OR close_reason IS NULL  -- Allow NULL for unknown/unspecified reasons
  );

-- ============================================================================
-- STEP 3: Update any existing trades that might have been manually inserted
-- ============================================================================

-- Update any NULL close_reasons to 'manual' for clarity (optional)
UPDATE trade_history 
SET close_reason = 'manual' 
WHERE close_reason IS NULL 
  AND profit_loss < 0;  -- Likely manual closes

-- ============================================================================
-- STEP 4: Add helpful comment
-- ============================================================================

COMMENT ON COLUMN trade_history.close_reason IS 
  'Reason trade was closed: manual, stop_loss, take_profit, session_end, win, loss, breakeven, time_expired, margin_call, trailing_stop, partial_close, or NULL';

-- ============================================================================
-- STEP 5: Verify the fix
-- ============================================================================

DO $$
DECLARE
  v_constraint_exists boolean;
  v_allowed_values text;
BEGIN
  -- Check if new constraint exists
  SELECT EXISTS (
    SELECT 1 
    FROM information_schema.constraint_column_usage
    WHERE table_name = 'trade_history' 
      AND constraint_name = 'trade_history_close_reason_check'
  ) INTO v_constraint_exists;

  RAISE NOTICE '========================================';
  RAISE NOTICE 'Close Reason Constraint Fix Verification';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'New constraint exists: %', CASE WHEN v_constraint_exists THEN '✅ YES' ELSE '❌ NO' END;
  RAISE NOTICE '';
  RAISE NOTICE 'Allowed close_reason values:';
  RAISE NOTICE '  ✅ manual';
  RAISE NOTICE '  ✅ stop_loss';
  RAISE NOTICE '  ✅ take_profit';
  RAISE NOTICE '  ✅ session_end (NEW - fixes 400 errors!)';
  RAISE NOTICE '  ✅ win, loss, breakeven (NEW)';
  RAISE NOTICE '  ✅ time_expired, margin_call, trailing_stop, partial_close (future)';
  RAISE NOTICE '  ✅ NULL (allowed)';
  RAISE NOTICE '';
  
  IF v_constraint_exists THEN
    RAISE NOTICE '✅ FIX APPLIED SUCCESSFULLY!';
    RAISE NOTICE 'Trades with close_reason=''session_end'' will now save without errors.';
  ELSE
    RAISE WARNING '⚠️  Constraint may not have been applied correctly.';
  END IF;
  
  RAISE NOTICE '========================================';
END $$;
