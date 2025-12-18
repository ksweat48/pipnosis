/*
  # Remove Obsolete Scanning Functions

  ## Problem
  The `record_scan_completion` and `reset_scanning_cycle_counters` functions
  are trying to update columns that were removed in the December 17th simplification.
  
  These functions are obsolete and should be removed since the new system
  uses the simpler 15-minute confirmation flow.

  ## Solution
  1. Drop obsolete functions that reference removed columns
  2. Verify simplified scanning system is intact
  
  ## Impact
  - Fixes 400 errors when calling record_scan_completion
  - Removes dead code that references non-existent columns
  - No functionality loss - new system doesn't need these functions
*/

-- ============================================================================
-- Drop obsolete functions from the old scanning cycle system
-- ============================================================================

DROP FUNCTION IF EXISTS record_scan_completion(uuid, boolean) CASCADE;
DROP FUNCTION IF EXISTS reset_scanning_cycle_counters(uuid) CASCADE;
DROP FUNCTION IF EXISTS trigger_scanning_cooldown(uuid) CASCADE;
DROP FUNCTION IF EXISTS trigger_scanning_lockdown(uuid) CASCADE;

COMMENT ON FUNCTION should_show_continuation_modal(uuid) IS
  'Part of simplified 15-minute scanning system. Returns true if session needs continuation modal.';

COMMENT ON FUNCTION trigger_continuation_modal(uuid) IS
  'Part of simplified 15-minute scanning system. Shows continuation modal to user.';

-- ============================================================================
-- Verify simplified scanning system is in place
-- ============================================================================

DO $$
DECLARE
  v_columns_exist boolean;
BEGIN
  -- Check that new simplified columns exist
  SELECT 
    bool_and(column_name IN ('scanning_started_at', 'scanning_duration_minutes', 
                              'awaiting_continuation_confirmation', 
                              'continuation_confirmation_expires_at'))
  INTO v_columns_exist
  FROM information_schema.columns
  WHERE table_name = 'goal_sessions'
    AND column_name IN ('scanning_started_at', 'scanning_duration_minutes', 
                        'awaiting_continuation_confirmation', 
                        'continuation_confirmation_expires_at');

  IF NOT v_columns_exist THEN
    RAISE WARNING 'Simplified scanning columns not found. May need to re-run simplification migration.';
  END IF;
END $$;
