/*
  # Cleanup Remaining Candle State References

  ## Problem
  - Function `get_candle_stats` still references deleted `candle_state` table
  - Could cause errors if called

  ## Solution
  - Drop the orphaned function
*/

-- Drop orphaned monitoring function
DROP FUNCTION IF EXISTS get_candle_stats() CASCADE;

-- Verify no remaining references
DO $$
DECLARE
  ref_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO ref_count
  FROM information_schema.routines
  WHERE routine_schema = 'public'
    AND routine_definition LIKE '%candle_state%';
  
  IF ref_count > 0 THEN
    RAISE WARNING 'Still have % functions referencing candle_state', ref_count;
  ELSE
    RAISE NOTICE '✅ All candle_state references cleaned up';
  END IF;
END $$;
