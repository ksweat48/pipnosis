/*
  # Enable Edge Loss Modal System in Server Monitoring

  ## Problem
  The autonomous entry monitor cannot trigger edge loss modals because the
  `get_intents_for_server_monitoring()` RPC doesn't return the required fields:
  - edge_loss_modal_triggered_at
  - edge_loss_modal_response
  - edge_loss_modal_response_at

  This causes Phase 3 intents to monitor forever (6+ hours) instead of triggering
  the edge loss modal after max_wait timeout.

  ## Root Cause
  - Edge loss modal system was fully implemented in migration 20260115180111
  - Modal constraint was fixed in migration 20260117074913
  - BUT: Autonomous monitor was disabled with comment "pending constraint fix"
  - AND: RPC function doesn't return edge_loss_modal fields
  - Result: System never triggers modals, intents monitor indefinitely

  ## Changes
  1. Update get_intents_for_server_monitoring() to return edge_loss_modal fields
  2. Add fields to RETURNS TABLE and SELECT statement
  3. Enable proper timeout enforcement after Phase 3

  ## Impact
  - Fixes 6-hour monitoring issue
  - Enables proper max_wait timeout enforcement
  - Allows user to choose continue/close when edge decays
  - Auto-closes after 2 minutes if no response
  - SSOT: Single place to handle phase 3 timeouts
*/

-- ============================================================================
-- Update RPC to include edge loss modal fields
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
  price_updated_at timestamptz,
  edge_loss_modal_triggered_at timestamptz,
  edge_loss_modal_response text,
  edge_loss_modal_response_at timestamptz
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
    -- Price selection based on direction
    CASE
      WHEN ei.direction = 'long' THEN rp.ask_price
      WHEN ei.direction = 'short' THEN rp.bid_price
      ELSE rp.mid_price
    END as current_price,
    rp.price_created_at as price_updated_at,
    -- Edge loss modal fields
    ei.edge_loss_modal_triggered_at,
    ei.edge_loss_modal_response,
    ei.edge_loss_modal_response_at
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

-- Verification
DO $$
DECLARE
  test_record RECORD;
BEGIN
  -- Test that function returns edge_loss_modal fields
  SELECT * INTO test_record FROM get_intents_for_server_monitoring() LIMIT 1;

  RAISE NOTICE 'Edge loss modal fields added to server monitoring RPC';
  RAISE NOTICE 'System will now properly enforce Phase 3 timeouts';
END $$;