/*
  # Fix Entry Monitor: Execute Trade When Price Hits Zone at Timeout

  ## Problem
  When the entry intent's timeout_at is reached and price is simultaneously inside
  the entry zone, the server-side monitor was abandoning the intent instead of
  executing the trade. There were two compounding issues:

  1. The get_intents_for_server_monitoring RPC dropped intents more than 5 minutes
     past their timeout_at, preventing the monitor from ever seeing them.

  2. The Netlify monitor's timeout handler ran BEFORE the zone check, abandoning
     the intent without first checking if price was in the zone.

  ## Fix (Database Layer)
  Extend the RPC grace window from 5 minutes to 15 minutes so that intents which
  timed out while price was inside the zone can still be picked up and executed on
  the next monitor cycle.

  ## Fix (Application Layer — autonomous-entry-monitor.ts)
  Already applied: the timeout handler now checks if price is in zone first and
  executes the trade if so, only abandoning if price is outside the zone.

  ## Notes
  - Only affects intents that are still in 'monitoring' status (haven't been
    processed yet). Once abandoned/executed the status changes and they fall out.
  - The 15-minute window matches the longest SCALP timeout (10 min) plus a 5-min
    buffer for monitor scheduling lag.
*/

CREATE OR REPLACE FUNCTION public.get_intents_for_server_monitoring()
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
  m5_candle_close_confirmed boolean,
  session_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  COALESCE(ei.m5_candle_close_confirmed, false) as m5_candle_close_confirmed,
  COALESCE(gs.status::text, 'unknown') as session_status
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
  -- Extended grace window: 15 minutes past timeout_at.
  -- This ensures intents that timed out while price was inside the zone
  -- are still picked up on the next monitor cycle and executed rather
  -- than silently dropped from the query.
  AND (ei.timeout_at IS NULL OR ei.timeout_at > now() - interval '15 minutes')
ORDER BY ei.created_at ASC;
END;
$function$;
