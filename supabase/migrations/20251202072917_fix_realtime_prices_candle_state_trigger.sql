/*
  # Fix Realtime Prices Trigger - Remove Candle State Dependency

  ## Problem
  - The `realtime_prices` table has a trigger `trigger_update_candle_state`
  - This trigger calls `update_candle_state_on_price()` function
  - That function tries to write to the `candle_state` table which was deleted
  - Result: All price inserts fail with "relation candle_state does not exist"

  ## Solution
  - Drop the orphaned trigger
  - Drop the orphaned function
  - Keep the validation trigger (which is working correctly)

  ## Impact
  - ✅ Netlify price collector will work immediately
  - ✅ Prices will be saved to realtime_prices table
  - ✅ Candle aggregator will have fresh data to process
  - ✅ Charts will exit emergency mode
*/

-- Drop the problematic trigger
DROP TRIGGER IF EXISTS trigger_update_candle_state ON realtime_prices;

-- Drop the orphaned function
DROP FUNCTION IF EXISTS update_candle_state_on_price() CASCADE;

-- Verify the remaining trigger is correct
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'validate_realtime_prices_trigger' 
      AND tgrelid = 'public.realtime_prices'::regclass
  ) THEN
    RAISE EXCEPTION 'Validation trigger is missing!';
  END IF;
  
  RAISE NOTICE '✅ Realtime prices trigger fixed - candle_state dependency removed';
END $$;
