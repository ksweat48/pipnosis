/*
  # Fix Goal Session Trigger Blocking Position Closure

  ## Problem
  When users try to close positions, they get error:
  "record 'new' has no field 'goal_session_id'"

  ## Root Cause
  A trigger `trg_update_goal_summary` is attached to `simulated_positions` table
  and tries to access NEW.goal_session_id, which does NOT exist in that table.

  The column goal_session_id only exists in:
  - trade_history table
  - goal_session_trades table

  But NOT in simulated_positions table.

  ## Solution
  Remove the incorrectly attached trigger from simulated_positions.
  Goal session tracking is already handled properly in application code
  through position-monitor.ts lines 335-366.

  ## Impact
  - FIXES: Users can now close positions without errors
  - NO DATA LOSS: Goal session tracking continues via application code
  - NO BREAKING CHANGES: Existing functionality preserved

  ## Tables Affected
  - simulated_positions (trigger removed)

  ## Functions Modified
  - update_goal_session_summary() (remains unchanged, just not triggered incorrectly)
*/

-- ============================================================================
-- STEP 1: Remove broken trigger from simulated_positions
-- ============================================================================

-- This trigger was incorrectly attached to simulated_positions table
-- It tries to access NEW.goal_session_id which doesn't exist in that table
DROP TRIGGER IF EXISTS trg_update_goal_summary ON simulated_positions;

-- ============================================================================
-- STEP 2: Verify the function still exists (for potential future use)
-- ============================================================================

-- The function itself is fine, it was just attached to the wrong table
-- We keep the function in case it needs to be used elsewhere
-- (e.g., on trade_history or goal_session_trades)

-- Check if function exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'update_goal_session_summary'
  ) THEN
    RAISE NOTICE 'Function update_goal_session_summary() exists and is preserved';
  END IF;
END $$;

-- ============================================================================
-- STEP 3: Add comment to document the fix
-- ============================================================================

COMMENT ON FUNCTION update_goal_session_summary IS
  'Updates goal session summaries when trades close.
   NOTE: This function should only be used on tables that have goal_session_id column.
   Originally was incorrectly triggered on simulated_positions (fixed 2025-11-28).';

-- ============================================================================
-- STEP 4: Verify simulated_positions schema for documentation
-- ============================================================================

-- Document that simulated_positions does NOT have goal_session_id
-- This helps prevent future mistakes

DO $$
BEGIN
  -- Verify goal_session_id does NOT exist in simulated_positions
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'simulated_positions'
    AND column_name = 'goal_session_id'
  ) THEN
    RAISE WARNING 'Unexpected: goal_session_id column found in simulated_positions';
  ELSE
    RAISE NOTICE 'Confirmed: simulated_positions table does NOT have goal_session_id column (as expected)';
  END IF;
END $$;

-- ============================================================================
-- STEP 5: Verify trade_history has the column (for future reference)
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trade_history'
    AND column_name = 'goal_session_id'
  ) THEN
    RAISE NOTICE 'Confirmed: trade_history table HAS goal_session_id column (correct location)';
  END IF;
END $$;

-- ============================================================================
-- SUMMARY
-- ============================================================================

/*
  ✅ Removed broken trigger from simulated_positions
  ✅ Preserved update_goal_session_summary() function
  ✅ Verified schema to prevent future mistakes
  ✅ Users can now close positions without errors

  Goal session tracking continues to work via:
  - Application code (position-monitor.ts)
  - goal_session_trades table
  - trade_history records with goal_session_id
*/