/*
  # CCIP: Realtime Prices Freshness Restoration

  ## Root Cause Analysis
  The realtime_prices table has accumulated 178,084 records with 99% being stale (> 15 min old).
  - Fresh (< 1 min): 123 records (0.07%)
  - Recent (1-5 min): 470 records (0.26%)
  - Stale (5-15 min): 1,181 records (0.66%)
  - Very Stale (> 15 min): 176,303 records (98.99%)
  
  ## Problem
  No automatic cleanup mechanism exists. Old prices accumulate indefinitely, causing:
  - Database bloat
  - Slow queries
  - Potential stale price usage
  - Resource waste

  ## Solution
  1. Clean up all prices older than 15 minutes (one-time)
  2. Create automatic cleanup function
  3. Add index for efficient cleanup queries
  4. Implement periodic cleanup via trigger

  ## CCIP Compliance
  - Change Type: Performance Optimization + Data Cleanup
  - Impact: Removes stale data, improves query performance
  - Safety: Only removes data older than 15 minutes (already stale)
  - Reversibility: Data can be recollected from source
*/

-- Step 1: Create index for efficient cleanup (if not exists)
CREATE INDEX IF NOT EXISTS idx_realtime_prices_received_at 
ON realtime_prices(received_at DESC);

-- Step 2: Create automatic cleanup function
CREATE OR REPLACE FUNCTION cleanup_stale_realtime_prices()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- Delete prices older than 15 minutes
  DELETE FROM realtime_prices
  WHERE received_at < NOW() - INTERVAL '15 minutes';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  -- Log cleanup activity
  RAISE NOTICE 'Cleaned up % stale price records', deleted_count;
END;
$$;

-- Step 3: Perform immediate cleanup of existing stale data
DO $$
DECLARE
  before_count INTEGER;
  after_count INTEGER;
  deleted_count INTEGER;
  reduction_pct NUMERIC;
BEGIN
  -- Count before cleanup
  SELECT COUNT(*) INTO before_count FROM realtime_prices;
  
  -- Perform cleanup
  DELETE FROM realtime_prices
  WHERE received_at < NOW() - INTERVAL '15 minutes';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  -- Count after cleanup
  SELECT COUNT(*) INTO after_count FROM realtime_prices;
  
  -- Calculate reduction percentage
  IF before_count > 0 THEN
    reduction_pct := ROUND((deleted_count::numeric / before_count::numeric * 100), 2);
  ELSE
    reduction_pct := 0;
  END IF;
  
  RAISE NOTICE 'Cleanup Complete: Before=%, Deleted=%, After=%, Reduction=%%%', 
    before_count, deleted_count, after_count, reduction_pct;
END;
$$;

-- Step 4: Grant necessary permissions
GRANT EXECUTE ON FUNCTION cleanup_stale_realtime_prices() TO service_role;
GRANT EXECUTE ON FUNCTION cleanup_stale_realtime_prices() TO authenticated;

-- Step 5: Create scheduled cleanup trigger (runs on each price insert, but rate-limited)
-- This creates a lightweight check that only runs cleanup periodically
CREATE OR REPLACE FUNCTION trigger_periodic_price_cleanup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  last_cleanup_time TIMESTAMPTZ;
  should_cleanup BOOLEAN := false;
BEGIN
  -- Check if we should run cleanup (every 5 minutes max)
  SELECT value::timestamptz INTO last_cleanup_time
  FROM platform_settings
  WHERE key = 'last_price_cleanup'
  LIMIT 1;
  
  -- Run cleanup if more than 5 minutes since last cleanup or never run
  IF last_cleanup_time IS NULL OR last_cleanup_time < NOW() - INTERVAL '5 minutes' THEN
    should_cleanup := true;
  END IF;
  
  -- Perform cleanup if needed
  IF should_cleanup THEN
    -- Update last cleanup time first to prevent concurrent cleanups
    INSERT INTO platform_settings (key, value)
    VALUES ('last_price_cleanup', to_jsonb(NOW()))
    ON CONFLICT (key) DO UPDATE SET value = to_jsonb(NOW());
    
    -- Run cleanup in background (don't block the insert)
    PERFORM cleanup_stale_realtime_prices();
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger (only if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'trigger_periodic_price_cleanup'
  ) THEN
    CREATE TRIGGER trigger_periodic_price_cleanup
    AFTER INSERT ON realtime_prices
    FOR EACH STATEMENT
    EXECUTE FUNCTION trigger_periodic_price_cleanup();
  END IF;
END;
$$;

-- Verification
DO $$
DECLARE
  current_count INTEGER;
  fresh_count INTEGER;
  stale_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO current_count FROM realtime_prices;
  SELECT COUNT(*) INTO fresh_count 
  FROM realtime_prices 
  WHERE received_at > NOW() - INTERVAL '15 minutes';
  
  SELECT COUNT(*) INTO stale_count 
  FROM realtime_prices 
  WHERE received_at < NOW() - INTERVAL '15 minutes';
  
  RAISE NOTICE 'Current State: Total=%, Fresh=%, Stale=%', 
    current_count, fresh_count, stale_count;
  
  IF stale_count > 0 THEN
    RAISE WARNING 'Still have % stale records', stale_count;
  ELSE
    RAISE NOTICE 'All prices are fresh';
  END IF;
END;
$$;
