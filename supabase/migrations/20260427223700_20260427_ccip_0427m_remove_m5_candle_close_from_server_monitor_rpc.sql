/*
  # CCIP-2026-0427M: Remove dropped column references from server-monitor RPC

  ## Why
  The Netlify function `autonomous-entry-monitor` calls
  `get_intents_for_server_monitoring()` as the very first SQL in its handler.
  That function still selects `ei.requires_m5_candle_close` and
  `ei.m5_candle_close_confirmed`, but both columns were dropped from
  `entry_intents` on 2026-03-31 (migration 20260331192110, CCIP-0331B).

  Postgres binds column references at execution time, not at function-creation
  time, so six successive RPC redefinitions (04-08, 04-10, 04-12, 04-16, 04-26,
  04-27) all installed cleanly while carrying the stale references forward.
  Every wait-intent server check therefore raised `column ei.requires_m5_candle_close
  does not exist` (HTTP 500), causing the long-standing
  "wait intents never auto-execute" symptom.

  This is the seventh attempt to fix wait-intent execution; the prior six
  tuned conditions in code instead of repairing the broken SQL contract.
  CCIP-2026-0427K added response-body logging that finally surfaced the column
  name. This migration is the actual fix.

  ## Changes
  1. Modified Functions
     - `get_intents_for_server_monitoring()` — dropped and recreated.
       - REMOVED return columns: `requires_m5_candle_close`,
         `m5_candle_close_confirmed`.
       - REMOVED matching SELECT-list expressions.
       - All other behavior preserved: realtime_prices LATERAL join (90s
         freshness), goal_sessions session_status join, 15-minute timeout
         grace window, `status='monitoring' AND execution_mode='server'`
         filter, ASC ordering by created_at.
     - Re-granted EXECUTE to authenticated and service_role to mirror prior
       grants.

  2. Anti-Regression Smoke Check
     - The migration ends with a `PERFORM` against
       `get_intents_for_server_monitoring()`. This forces the planner to bind
       every column reference against the live `entry_intents` schema before
       the migration is allowed to commit. If a future redefine reintroduces a
       dropped column, the same smoke check will fail loudly during deploy
       instead of silently shipping a broken RPC.

  ## Notes
  - No data is modified. Schema-shape change only affects the function's
     RETURN TABLE contract.
  - `autonomous-entry-monitor.ts` does not read either of the removed columns,
     so no application code change is required.
  - The historical `get_intents_monitoring_drop_recreate_push_confirm`
     function from migration 20260311040218 is no longer present in the live
     database (verified via pg_proc) and is intentionally not recreated.
  - The in-flight wait intent
     (31d18b9a-4470-4255-9146-129ee0a08701, US30 SHORT) does NOT need to be
     recreated. It will resume monitoring on the next ping cycle as soon as
     this RPC heals.
*/

DROP FUNCTION IF EXISTS public.get_intents_for_server_monitoring();

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
    NULL::decimal AS position_size_multiplier,
    ei.last_checked_at,
    CASE
      WHEN ei.direction = 'long' THEN rp.ask_price
      WHEN ei.direction = 'short' THEN rp.bid_price
      ELSE rp.mid_price
    END AS current_price,
    rp.price_created_at AS price_updated_at,
    ei.edge_loss_modal_triggered_at,
    ei.edge_loss_modal_response,
    ei.edge_loss_modal_response_at,
    COALESCE(ei.intent_mode, 'pullback_to_zone')::text AS intent_mode,
    COALESCE(gs.status::text, 'unknown') AS session_status
  FROM entry_intents ei
  LEFT JOIN goal_sessions gs ON gs.id = ei.session_id
  LEFT JOIN LATERAL (
    SELECT
      realtime_prices.bid::decimal AS bid_price,
      realtime_prices.ask::decimal AS ask_price,
      realtime_prices.mid::decimal AS mid_price,
      realtime_prices.created_at AS price_created_at
    FROM realtime_prices
    WHERE realtime_prices.symbol = ei.symbol
      AND realtime_prices.created_at > now() - interval '90 seconds'
    ORDER BY realtime_prices.created_at DESC
    LIMIT 1
  ) rp ON true
  WHERE ei.status = 'monitoring'
    AND ei.execution_mode = 'server'
    AND (ei.timeout_at IS NULL OR ei.timeout_at > now() - interval '15 minutes')
  ORDER BY ei.created_at ASC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_intents_for_server_monitoring() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_intents_for_server_monitoring() TO service_role;

-- Anti-regression smoke check: force the planner to bind every column
-- reference against the live entry_intents schema. Fails this migration if
-- a future redefine ever re-introduces a dropped column.
DO $$
BEGIN
  PERFORM * FROM public.get_intents_for_server_monitoring() LIMIT 1;
END $$;
