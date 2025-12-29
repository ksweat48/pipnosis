/*
  # Fix Trade Execution Blocking Errors

  ## Problem
  Three critical issues are preventing trade execution:
  1. Numeric overflow in entry_monitoring_logs when tracking US30 index prices
  2. 403 Forbidden errors on cache_stats_log (authenticated users can't insert)
  3. 403 Forbidden errors on omega_market_intelligence (authenticated users can't insert/update)

  ## Changes
  1. Increase column precision in entry_monitoring_logs:
     - current_price: decimal(10,5) → decimal(20,8) (handle all asset types)
     - distance_to_zone_pips: decimal(6,2) → decimal(12,2) (handle large pip distances)

  2. Add INSERT policy for cache_stats_log:
     - Allow authenticated users to insert cache statistics
     - This is a logging table where all users contribute metrics

  3. Add INSERT/UPDATE policies for omega_market_intelligence:
     - Allow authenticated users to insert and update intelligence data
     - This is a platform-wide shared knowledge base where all users contribute

  ## Security
  - All tables remain protected by RLS
  - Authenticated users can write to shared intelligence tables
  - Service role retains full access
  - Admin and regular users can both execute trades
*/

-- =====================================================
-- Fix 1: Increase numeric precision for entry monitoring
-- =====================================================

-- Increase current_price precision to handle all asset types (forex, indices, crypto)
ALTER TABLE entry_monitoring_logs
  ALTER COLUMN current_price TYPE decimal(20, 8);

-- Increase distance_to_zone_pips precision to handle large pip distances
-- Example: US30 at 48607 can have distances of 2,000,000+ pips
ALTER TABLE entry_monitoring_logs
  ALTER COLUMN distance_to_zone_pips TYPE decimal(12, 2);

-- =====================================================
-- Fix 2: Add RLS policies for cache_stats_log
-- =====================================================

-- Allow authenticated users to insert cache statistics
DROP POLICY IF EXISTS "Authenticated users can insert cache stats" ON cache_stats_log;

CREATE POLICY "Authenticated users can insert cache stats"
  ON cache_stats_log
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- =====================================================
-- Fix 3: Add RLS policies for omega_market_intelligence
-- =====================================================

-- Allow authenticated users to insert omega intelligence
DROP POLICY IF EXISTS "Authenticated users can insert omega intelligence" ON omega_market_intelligence;

CREATE POLICY "Authenticated users can insert omega intelligence"
  ON omega_market_intelligence
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Allow authenticated users to update omega intelligence
DROP POLICY IF EXISTS "Authenticated users can update omega intelligence" ON omega_market_intelligence;

CREATE POLICY "Authenticated users can update omega intelligence"
  ON omega_market_intelligence
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- Verification
-- =====================================================

-- Log the fix completion
DO $$
BEGIN
  RAISE NOTICE '✓ Trade execution blocking errors fixed:';
  RAISE NOTICE '  - entry_monitoring_logs columns increased to handle all asset types';
  RAISE NOTICE '  - cache_stats_log now accepts authenticated user inserts';
  RAISE NOTICE '  - omega_market_intelligence now accepts authenticated user inserts/updates';
  RAISE NOTICE '  - Both admin and regular users can now execute trades';
END $$;
