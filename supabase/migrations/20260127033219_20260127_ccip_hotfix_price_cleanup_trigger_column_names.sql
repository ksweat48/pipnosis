/*
  # CCIP Hotfix: Fix Price Cleanup Trigger Column Name Mismatch

  ## Root Cause
  Migration 20260126_ccip_realtime_prices_freshness_restoration created trigger_periodic_price_cleanup()
  that references platform_settings columns as 'key' and 'value', but actual column names are 
  'setting_key' and 'setting_value'. This causes EVERY price insert to fail, blocking all price collection.

  ## Impact
  - CRITICAL: All price inserts blocked since 20260126 migration
  - Hybrid price collector runs successfully but inserts fail
  - System shows stale data (6+ hours old) despite collector health metrics showing success
  - Positions at risk due to no fresh price data

  ## Fix
  Update trigger_periodic_price_cleanup() function to use correct column names.

  ## CCIP Compliance
  - Change Type: Hotfix - Corrects schema mismatch bug
  - Impact: CRITICAL - Unblocks all price collection immediately
  - Safety: No data loss, only fixes column references
  - Test: Manual insert test after migration
*/

-- Fix the trigger function to use correct column names
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
  -- FIXED: Use setting_key and setting_value instead of key and value
  SELECT setting_value::text::timestamptz INTO last_cleanup_time
  FROM platform_settings
  WHERE setting_key = 'last_price_cleanup'
  LIMIT 1;
  
  -- Run cleanup if more than 5 minutes since last cleanup or never run
  IF last_cleanup_time IS NULL OR last_cleanup_time < NOW() - INTERVAL '5 minutes' THEN
    should_cleanup := true;
  END IF;
  
  -- Perform cleanup if needed
  IF should_cleanup THEN
    -- Update last cleanup time first to prevent concurrent cleanups
    -- FIXED: Use setting_key and setting_value
    INSERT INTO platform_settings (setting_key, setting_value, description)
    VALUES ('last_price_cleanup', to_jsonb(NOW()), 'Last automatic price cleanup timestamp')
    ON CONFLICT (setting_key) DO UPDATE SET 
      setting_value = to_jsonb(NOW()),
      updated_at = NOW();
    
    -- Run cleanup in background (don't block the insert)
    PERFORM cleanup_stale_realtime_prices();
  END IF;
  
  RETURN NEW;
END;
$$;

-- Verification: Test that a price insert now works
DO $$
DECLARE
  test_insert_success BOOLEAN := false;
  test_id UUID;
BEGIN
  -- Attempt test insert
  BEGIN
    INSERT INTO realtime_prices (symbol, bid, ask, mid, spread, broker_time, source)
    VALUES ('EURUSD', 1.18800, 1.18805, 1.188025, 0.00005, NOW(), 'ccip_test')
    RETURNING id INTO test_id;
    
    test_insert_success := true;
    
    -- Clean up test insert
    DELETE FROM realtime_prices WHERE id = test_id;
    
  EXCEPTION WHEN OTHERS THEN
    test_insert_success := false;
    RAISE WARNING 'Test insert failed: %', SQLERRM;
  END;
  
  IF test_insert_success THEN
    RAISE NOTICE '✅ HOTFIX VERIFIED: Price inserts now working';
  ELSE
    RAISE EXCEPTION '❌ HOTFIX FAILED: Price inserts still blocked';
  END IF;
END;
$$;
