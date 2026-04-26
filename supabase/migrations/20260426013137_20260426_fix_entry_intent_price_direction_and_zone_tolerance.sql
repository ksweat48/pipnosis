/*
  # Fix Entry Intent Execution — Two Root-Cause Bugs

  ## Problem
  Entry intents with `wait_pullback` direction were never triggering execution
  because of two compounding bugs:

  1. **Wrong price for SHORT direction in `get_intents_for_server_monitoring`**:
     The RPC used `bid_price` for SHORT fills. A SHORT fill requires ask to reach
     the sell zone (zone sits above current price, ask = bid + spread). Using bid
     for SHORT creates a permanent spread-sized gap below the zone floor, making the
     zone check always return false even when the UI shows "Pullback Zone Reached".

  2. **Zero zone tolerance for INTRADAY in `get_entry_time_thresholds`**:
     Phase 1 tolerance was 0 pips for all styles. With exact-match only, a fractional
     spread or rounding difference causes the zone check to fail. INTRADAY Phase 1 is
     now 2 pips to provide a practical buffer without compromising entry quality.

  ## Changes
  - `get_intents_for_server_monitoring`: SHORT direction now uses ask_price (was bid_price)
  - `get_entry_time_thresholds`: INTRADAY zone_tolerance_phase1 changed from 0 to 2 pips

  ## CCIP Reference
  CCIP-2026-0426A — Entry intent price direction + zone tolerance fix
*/

-- ============================================================
-- Fix 1: Correct price direction for SHORT fills
-- DROP required because the existing signature uses urgency_phase integer
-- whereas earlier migration attempts used text — PostgreSQL rejects REPLACE
-- when OUT parameter types differ.
-- ============================================================
DROP FUNCTION IF EXISTS get_intents_for_server_monitoring();

CREATE FUNCTION get_intents_for_server_monitoring()
RETURNS TABLE (
  intent_id uuid,
  user_id uuid,
  session_id uuid,
  symbol text,
  intent_type text,
  urgency text,
  direction text,
  entry_zone_min numeric,
  entry_zone_max numeric,
  timeout_at timestamptz,
  max_wait_seconds integer,
  timeout_action text,
  invalidation_price numeric,
  alpha_confidence numeric,
  alpha_reasoning text,
  market_context jsonb,
  status text,
  created_at timestamptz,
  execution_mode text,
  server_heartbeat timestamptz,
  urgency_phase integer,
  zone_tolerance_pips numeric,
  time_adjusted_threshold numeric,
  zone_type text,
  micro_regime_used text,
  primary_zone_min numeric,
  primary_zone_max numeric,
  secondary_zone_min numeric,
  secondary_zone_max numeric,
  zone_reachability_distance_pips numeric,
  position_size_multiplier numeric,
  last_checked_at timestamptz,
  current_price numeric,
  price_updated_at timestamptz,
  edge_loss_modal_triggered_at timestamptz,
  edge_loss_modal_response text,
  edge_loss_modal_response_at timestamptz,
  intent_mode text,
  requires_m5_candle_close boolean,
  m5_candle_close_confirmed boolean,
  session_status text,
  trigger_event text
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
    NULL::numeric as position_size_multiplier,
    ei.last_checked_at,
    -- CCIP-2026-0426A: Use ask_price for both LONG and SHORT directions.
    -- For wait_pullback SHORT: zone is ABOVE current price. Price rises into
    -- the zone. The ask is the fill-side price for inbound short sells.
    -- Using bid_price created a permanent spread gap (~0.2-0.5) below the
    -- zone floor, preventing zone detection even when mid was inside the zone.
    CASE
      WHEN ei.direction = 'long'  THEN COALESCE(rp.ask_price, rp.mid_price)
      WHEN ei.direction = 'short' THEN COALESCE(rp.ask_price, rp.mid_price)
      ELSE                             COALESCE(rp.mid_price,  rp.ask_price)
    END as current_price,
    rp.price_created_at as price_updated_at,
    ei.edge_loss_modal_triggered_at,
    ei.edge_loss_modal_response,
    ei.edge_loss_modal_response_at,
    COALESCE(ei.intent_mode, 'pullback_to_zone')::text as intent_mode,
    false::boolean as requires_m5_candle_close,
    false::boolean as m5_candle_close_confirmed,
    COALESCE(gs.status::text, 'unknown') as session_status,
    ei.trigger_event
  FROM entry_intents ei
  LEFT JOIN goal_sessions gs ON gs.id = ei.session_id
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
    AND (ei.timeout_at IS NULL OR ei.timeout_at > now() - interval '15 minutes')
  ORDER BY ei.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_intents_for_server_monitoring() TO authenticated;
GRANT EXECUTE ON FUNCTION get_intents_for_server_monitoring() TO service_role;

-- ============================================================
-- Fix 2: Raise INTRADAY Phase 1 zone tolerance from 0 to 2 pips
-- get_entry_time_thresholds has identical OUT param types so OR REPLACE works.
-- ============================================================
CREATE OR REPLACE FUNCTION get_entry_time_thresholds(p_trade_style text)
RETURNS TABLE (
  optimal_wait_min integer,
  acceptable_wait_min integer,
  max_wait_min integer,
  eqs_phase2_min integer,
  eqs_phase3_min integer,
  eqs_threshold_phase1 integer,
  eqs_threshold_phase2 integer,
  eqs_threshold_phase3 integer,
  zone_tolerance_phase1 integer,
  zone_tolerance_phase2 integer,
  zone_tolerance_phase3 integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    -- Time windows (unchanged)
    CASE p_trade_style
      WHEN 'SCALP'         THEN 3
      WHEN 'MICRO_INTRADAY' THEN 15
      WHEN 'INTRADAY'      THEN 45
      ELSE 15
    END AS optimal_wait_min,
    CASE p_trade_style
      WHEN 'SCALP'         THEN 7
      WHEN 'MICRO_INTRADAY' THEN 30
      WHEN 'INTRADAY'      THEN 90
      ELSE 30
    END AS acceptable_wait_min,
    CASE p_trade_style
      WHEN 'SCALP'         THEN 10
      WHEN 'MICRO_INTRADAY' THEN 45
      WHEN 'INTRADAY'      THEN 120
      ELSE 45
    END AS max_wait_min,
    CASE p_trade_style
      WHEN 'SCALP'         THEN 3
      WHEN 'MICRO_INTRADAY' THEN 15
      WHEN 'INTRADAY'      THEN 45
      ELSE 15
    END AS eqs_phase2_min,
    CASE p_trade_style
      WHEN 'SCALP'         THEN 7
      WHEN 'MICRO_INTRADAY' THEN 30
      WHEN 'INTRADAY'      THEN 90
      ELSE 30
    END AS eqs_phase3_min,

    -- EQS thresholds (unchanged)
    CASE p_trade_style
      WHEN 'SCALP'         THEN 70
      WHEN 'MICRO_INTRADAY' THEN 65
      WHEN 'INTRADAY'      THEN 60
      ELSE 65
    END AS eqs_threshold_phase1,
    CASE p_trade_style
      WHEN 'SCALP'         THEN 60
      WHEN 'MICRO_INTRADAY' THEN 55
      WHEN 'INTRADAY'      THEN 50
      ELSE 55
    END AS eqs_threshold_phase2,
    CASE p_trade_style
      WHEN 'SCALP'         THEN 50
      WHEN 'MICRO_INTRADAY' THEN 45
      WHEN 'INTRADAY'      THEN 40
      ELSE 45
    END AS eqs_threshold_phase3,

    -- Zone tolerance in pips
    -- CCIP-2026-0426A: INTRADAY Phase 1 raised from 0 to 2 pips to prevent
    -- spread-induced zone detection misses during the initial monitoring window.
    CASE p_trade_style
      WHEN 'SCALP'         THEN 0
      WHEN 'MICRO_INTRADAY' THEN 0
      WHEN 'INTRADAY'      THEN 2
      ELSE 2
    END AS zone_tolerance_phase1,
    CASE p_trade_style
      WHEN 'SCALP'         THEN 1
      WHEN 'MICRO_INTRADAY' THEN 2
      WHEN 'INTRADAY'      THEN 3
      ELSE 2
    END AS zone_tolerance_phase2,
    CASE p_trade_style
      WHEN 'SCALP'         THEN 2
      WHEN 'MICRO_INTRADAY' THEN 5
      WHEN 'INTRADAY'      THEN 7
      ELSE 5
    END AS zone_tolerance_phase3;
END;
$$;

GRANT EXECUTE ON FUNCTION get_entry_time_thresholds(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_entry_time_thresholds(text) TO service_role;
