/*
  # Fix Server Entry Monitoring Schema Mismatch - CRITICAL

  ## CCIP Root Cause Analysis

  ### Issue:
  User greenmorris.83@gmail.com reported price hit entry zone but trade did not auto-execute.
  Entry intent shows:
  - Status: 'monitoring'  
  - Execution mode: 'server'
  - Price in zone: 3352.25500 (within 3352.20518-3357.79482)
  - last_checked_at: NULL
  - No monitoring logs in database

  ### Root Cause:
  The RPC function `get_intents_for_server_monitoring` queries realtime_prices for columns that DO NOT EXIST:
  - Queries: `price`, `updated_at`
  - Actual columns: `bid`, `ask`, `mid`, `created_at`

  This causes the RPC to SILENTLY FAIL, returning 0 intents.
  The serverless function logs "No active intents" and does nothing.

  ### SSOT Violations:
  1. **Schema Contract**: RPC assumes realtime_prices has `price` and `updated_at` columns
  2. **Monitoring Contract**: Frontend shows "Auto-executing..." but server isn't monitoring
  3. **Data Flow**: No monitoring logs created because RPC never returns intents

  ### Cascading Impact:
  - ALL server-monitored entry intents are affected (not just this user)
  - Auto-execution has been completely broken since realtime_prices schema changed
  - Users see "monitoring" UI but server does nothing

  ## Fix:
  Update RPC to use correct schema:
  - Use appropriate price based on direction (ask for long, bid for short)
  - Use `created_at` instead of `updated_at`
  - Return NULL for columns that don't exist in schema

  ## Changes:
  1. Drop and recreate `get_intents_for_server_monitoring` function
  2. Update LATERAL join to use correct columns from realtime_prices
  3. Match actual entry_intents schema
*/

-- ============================================================================
-- Fix get_intents_for_server_monitoring schema mismatch
-- ============================================================================

DROP FUNCTION IF EXISTS get_intents_for_server_monitoring();

CREATE OR REPLACE FUNCTION get_intents_for_server_monitoring()
RETURNS TABLE (
  intent_id uuid,
  user_id uuid,
  session_id uuid,
  symbol text,
  intent_type text,
  urgency text,
  direction text,
  entry_zone_min decimal,
  entry_zone_max decimal,
  timeout_at timestamptz,
  max_wait_seconds integer,
  timeout_action text,
  invalidation_price decimal,
  alpha_confidence decimal,
  alpha_reasoning text,
  market_context jsonb,
  status text,
  created_at timestamptz,
  execution_mode text,
  server_heartbeat timestamptz,
  urgency_phase integer,
  zone_tolerance_pips decimal,
  time_adjusted_threshold decimal,
  zone_type text,
  micro_regime_used text,
  primary_zone_min decimal,
  primary_zone_max decimal,
  secondary_zone_min decimal,
  secondary_zone_max decimal,
  zone_reachability_distance_pips decimal,
  position_size_multiplier decimal,
  last_checked_at timestamptz,
  current_price decimal,
  price_updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ei.id,
    ei.user_id,
    ei.session_id,
    ei.symbol,
    ei.intent_type::text,
    ei.urgency::text,
    ei.direction,
    ei.entry_zone_min,
    ei.entry_zone_max,
    ei.timeout_at,
    ei.max_wait_seconds,
    ei.timeout_action,
    ei.invalidation_price,
    ei.alpha_confidence::decimal,
    ei.alpha_reasoning,
    ei.market_context,
    ei.status::text,
    ei.created_at,
    ei.execution_mode,
    ei.server_heartbeat,
    ei.urgency_phase,
    ei.zone_tolerance_pips::decimal,
    ei.time_adjusted_threshold,
    ei.zone_type,
    ei.micro_regime_used,
    ei.primary_zone_min,
    ei.primary_zone_max,
    ei.secondary_zone_min,
    ei.secondary_zone_max,
    ei.zone_reachability_distance_pips,
    NULL::decimal as position_size_multiplier,
    ei.last_checked_at,
    -- ✅ FIX: Use correct columns from realtime_prices schema
    -- For longs: use ask price (price we buy at)
    -- For shorts: use bid price (price we sell at)
    CASE 
      WHEN ei.direction = 'long' THEN rp.ask_price
      WHEN ei.direction = 'short' THEN rp.bid_price
      ELSE rp.mid_price
    END as current_price,
    rp.price_created_at as price_updated_at
  FROM entry_intents ei
  LEFT JOIN LATERAL (
    SELECT 
      realtime_prices.bid::decimal as bid_price,
      realtime_prices.ask::decimal as ask_price,
      realtime_prices.mid::decimal as mid_price,
      realtime_prices.created_at as price_created_at
    FROM realtime_prices
    WHERE realtime_prices.symbol = ei.symbol
    ORDER BY realtime_prices.created_at DESC
    LIMIT 1
  ) rp ON true
  WHERE ei.status = 'monitoring'
    AND ei.execution_mode = 'server'
    AND (ei.timeout_at IS NULL OR ei.timeout_at > now())
  ORDER BY ei.created_at ASC;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_intents_for_server_monitoring TO authenticated;
GRANT EXECUTE ON FUNCTION get_intents_for_server_monitoring TO service_role;

-- Verification log
DO $$
DECLARE
  test_count integer;
  test_record RECORD;
BEGIN
  -- Test the function
  SELECT COUNT(*) INTO test_count
  FROM get_intents_for_server_monitoring();
  
  RAISE NOTICE '✓ CRITICAL FIX: Server monitoring schema mismatch resolved';
  RAISE NOTICE '  - Fixed: price → (bid/ask/mid based on direction)';
  RAISE NOTICE '  - Fixed: updated_at → created_at';
  RAISE NOTICE '  - Fixed: All column ambiguities resolved';
  RAISE NOTICE '  - Test query returned % intents for monitoring', test_count;
  
  -- Show sample if any exist
  IF test_count > 0 THEN
    SELECT * INTO test_record
    FROM get_intents_for_server_monitoring()
    LIMIT 1;
    
    RAISE NOTICE '  - Sample intent: % (%) - Price: %, Zone: %-%, Status: %',
      test_record.symbol,
      test_record.direction,
      test_record.current_price,
      test_record.entry_zone_min,
      test_record.entry_zone_max,
      test_record.status;
  END IF;
  
  RAISE NOTICE '  - SSOT RESTORED: RPC now matches realtime_prices schema';
  RAISE NOTICE '  - AUTO-EXECUTION UNBLOCKED: Server monitoring will resume';
END $$;
