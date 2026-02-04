/*
  # Disable Realtime on realtime_prices (Cost Reduction)

  **Problem:** $465/month bill from 176M Realtime messages
  **Solution:** Remove realtime_prices from Realtime publication
  **Expected Savings:** $400+/month (95% reduction)

  This migration implements CCIP-approved architecture change to replace
  Realtime broadcasting with edge function + client-side polling.
*/

-- Remove realtime_prices from Realtime publication
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE realtime_prices;
  RAISE NOTICE '✅ Removed realtime_prices from Realtime publication';
  RAISE NOTICE '💰 Expected savings: $400+/month';
EXCEPTION
  WHEN undefined_object THEN
    RAISE NOTICE '⚠️ realtime_prices not in publication (already removed)';
  WHEN undefined_table THEN
    RAISE NOTICE '⚠️ realtime_prices table does not exist';
END $$;

-- Verification query
DO $$
DECLARE
  is_in_publication BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND tablename = 'realtime_prices'
  ) INTO is_in_publication;

  IF is_in_publication THEN
    RAISE WARNING '❌ FAILED: realtime_prices still in Realtime publication!';
  ELSE
    RAISE NOTICE '✅ VERIFIED: realtime_prices removed from Realtime';
  END IF;
END $$;