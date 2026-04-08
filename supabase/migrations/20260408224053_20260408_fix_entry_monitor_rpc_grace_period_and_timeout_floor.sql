/*
  # Fix entry monitor RPC — grace period for near-expiry intents

  ## Summary
  The `get_intents_for_server_monitoring` RPC previously filtered out intents
  whose `timeout_at` had already passed (`timeout_at > now()`). This created a
  race condition for intents with short timeouts (e.g. those downgraded from
  `execute_now` to `wait_pullback` via CCIP-2026-0402A), which could expire before
  the server monitor's first 1-minute polling cycle ran.

  ## Change
  - Extended the expiry filter to `timeout_at > now() - interval '5 minutes'`
    so recently-expired intents get at least one server-monitor check cycle before
    being silently skipped.
  - No schema changes. No data loss. No security changes.

  ## Root cause (CCIP-2026-0408A)
  When Alpha returns `execute_now` but Q6=NONE_YET, CCIP-0402A downgrades to
  `wait_pullback` without synthesising a `wait_condition`. The `immediate_momentum`
  classifier gives these intents `timeout_minutes = 1` (~60 second window). The
  30-minute floor in `createMonitored()` (CCIP-0404B) ensures new intents are
  stored with `timeout_minutes = 30`. However, any intents created before the
  floor was deployed, or created via a race, would expire before the monitor ran.
  The 5-minute grace window closes this gap permanently.
*/

DROP FUNCTION IF EXISTS public.get_intents_for_server_monitoring();

CREATE FUNCTION public.get_intents_for_server_monitoring()
RETURNS TABLE(
  intent_id uuid,
  user_id uuid,
  session_id uuid,
  symbol text,
  intent_type text,
  urgency text,
  direction text,
  entry_zone_min numeric,
  entry_zone_max numeric,
  timeout_at timestamp with time zone,
  max_wait_seconds integer,
  timeout_action text,
  invalidation_price numeric,
  alpha_confidence numeric,
  alpha_reasoning text,
  market_context jsonb,
  status text,
  created_at timestamp with time zone,
  execution_mode text,
  server_heartbeat timestamp with time zone,
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
  last_checked_at timestamp with time zone,
  current_price numeric,
  price_updated_at timestamp with time zone,
  edge_loss_modal_triggered_at timestamp with time zone,
  edge_loss_modal_response text,
  edge_loss_modal_response_at timestamp with time zone,
  intent_mode text,
  requires_m5_candle_close boolean,
  m5_candle_close_confirmed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
  CASE
    WHEN ei.direction = 'long' THEN rp.ask_price
    WHEN ei.direction = 'short' THEN rp.bid_price
    ELSE rp.mid_price
  END as current_price,
  rp.price_created_at as price_updated_at,
  ei.edge_loss_modal_triggered_at,
  ei.edge_loss_modal_response,
  ei.edge_loss_modal_response_at,
  COALESCE(ei.intent_mode, 'pullback_to_zone')::text as intent_mode,
  COALESCE(ei.requires_m5_candle_close, false) as requires_m5_candle_close,
  COALESCE(ei.m5_candle_close_confirmed, false) as m5_candle_close_confirmed
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
AND (ei.timeout_at IS NULL OR ei.timeout_at > now() - interval '5 minutes');
END;
$$;
