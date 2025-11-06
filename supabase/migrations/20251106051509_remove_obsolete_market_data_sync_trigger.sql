/*
  # Remove Obsolete Market Data Sync Trigger
  
  ## Summary
  Removes the sync trigger and function that attempted to sync forex_candles to the
  now-deleted market_data table. This was causing insert failures.
  
  ## Changes
  1. Drop the sync_to_market_data trigger on forex_candles
  2. Drop the sync_forex_candles_to_market_data() function
  
  ## Security
  - No impact on RLS policies
  - Removes obsolete sync logic that referenced deleted table
*/

-- Drop the trigger
DROP TRIGGER IF EXISTS sync_to_market_data ON forex_candles;

-- Drop the function
DROP FUNCTION IF EXISTS sync_forex_candles_to_market_data();
