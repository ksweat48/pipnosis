/*
  # Fix Wait Intent Session Guard — Restore Execution Pipeline

  ## Problem
  The `get_intents_for_server_monitoring` RPC added an INNER JOIN on goal_sessions on
  2026-04-10 that filters out intents whose session status is terminal (user_stopped,
  goal_achieved, stopped, timeout, weekend_shutdown).

  However, sessions were transitioning to 'user_stopped' WHILE wait intents were still
  actively monitoring (within their timeout window). The INNER JOIN then silently dropped
  those intents from the RPC result, so the autonomous entry monitor never saw them
  and never executed the trade — even when price hit the zone.

  ## Root Cause
  The intent's own `timeout_at` is the SSOT for whether it is still alive.
  Session status is NOT a reliable signal for this — the session can legitimately
  transition to 'user_stopped' while a deferred intent is still in its wait window.

  ## Fix
  - Replace the hard INNER JOIN session filter with a permissive LEFT JOIN
  - Allow intents to be monitored if their timeout_at has not expired, regardless
    of session status
  - Only block execution of intents whose PARENT SESSION IS TERMINAL AND the intent's
    own timeout has already passed (belt-and-suspenders guard inside executeIntent)
  - Add a session_status column to the result so the entry monitor can log/audit
    the session state without blocking execution

  ## Safety
  The autonomous-entry-monitor.ts executeIntent() function already validates the
  session state before inserting a trade — this change just restores visibility
  so the monitor can make that decision itself instead of being blind to the intent.
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
  m5_candle_close_confirmed boolean,
  session_status text
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
  COALESCE(ei.m5_candle_close_confirmed, false) as m5_candle_close_confirmed,
  COALESCE(gs.status::text, 'unknown') as session_status
FROM entry_intents ei
-- LEFT JOIN so session status does not silently drop valid monitoring intents.
-- The intent's own timeout_at is the SSOT for whether it is still alive.
-- The entry monitor reads session_status and can make execution decisions itself.
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
-- The intent's timeout_at is the authority. Allow a 5 minute grace window
-- for monitor lag. If timeout has passed by more than 5 minutes, skip.
AND (ei.timeout_at IS NULL OR ei.timeout_at > now() - interval '5 minutes')
-- Do NOT filter by session status here. The monitor will log and skip if needed.
ORDER BY ei.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_intents_for_server_monitoring() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_intents_for_server_monitoring() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_intents_for_server_monitoring() TO anon;
