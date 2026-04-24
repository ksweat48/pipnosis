/*
  # CCIP-2026-0426A — Add PENDING_ZONE_ENTRY fourth decision mode

  ## Why this change
  Alpha currently has three execution modes: execute_now, wait_pullback, push_confirmation.
  This migration adds a fourth mode — pending_zone_entry — allowing Alpha to arm a
  trigger at a specific structural zone and fire immediately (market execution, no
  re-reasoning) when a named trigger event occurs inside that zone.

  Decision priority (all regimes, all pairs, all sessions):
    1. Execute Now
    2. Wait Pullback
    3. Pending Zone Entry  (NEW)
    4. No Trade

  ## Schema changes
  1. Extend entry_intents.entry_mode CHECK constraint to allow pending_zone_entry.
  2. Extend entry_intents.intent_mode CHECK constraint to allow pending_zone_entry_zone.
  3. Add trigger_event TEXT column to entry_intents. Stores the structural trigger Alpha
     armed so the server monitor knows what to wait for before firing. Values (nullable):
     reclaim_close, sweep_and_reclaim, bos_confirmation, range_boundary_touch, equal_level_touch.
  4. Drop and recreate get_intents_for_server_monitoring RPC to return trigger_event so the
     Netlify monitor can evaluate the fire condition.

  ## Security
  No RLS changes. RPC remains SECURITY DEFINER with the same search_path.

  ## Backwards compatibility
  - trigger_event is nullable; existing intents are unaffected.
  - New enum values are additive; existing intents continue to validate.
*/

-- 1. Extend entry_mode constraint
ALTER TABLE entry_intents DROP CONSTRAINT IF EXISTS entry_intents_entry_mode_check;
ALTER TABLE entry_intents ADD CONSTRAINT entry_intents_entry_mode_check
  CHECK ((entry_mode)::text = ANY ((ARRAY[
    'immediate'::character varying,
    'wait_pullback'::character varying,
    'wait_confirmation'::character varying,
    'execute_now'::character varying,
    'push_confirmation'::character varying,
    'pending_zone_entry'::character varying
  ])::text[]));

-- 2. Extend intent_mode constraint
ALTER TABLE entry_intents DROP CONSTRAINT IF EXISTS entry_intents_intent_mode_check;
ALTER TABLE entry_intents ADD CONSTRAINT entry_intents_intent_mode_check
  CHECK (intent_mode = ANY (ARRAY[
    'pullback_to_zone'::text,
    'push_confirmation_zone'::text,
    'pending_zone_entry_zone'::text
  ]));

-- 3. Add trigger_event column with allowed-value constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'trigger_event'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN trigger_event TEXT;
  END IF;
END $$;

ALTER TABLE entry_intents DROP CONSTRAINT IF EXISTS entry_intents_trigger_event_check;
ALTER TABLE entry_intents ADD CONSTRAINT entry_intents_trigger_event_check
  CHECK (trigger_event IS NULL OR trigger_event = ANY (ARRAY[
    'reclaim_close'::text,
    'sweep_and_reclaim'::text,
    'bos_confirmation'::text,
    'range_boundary_touch'::text,
    'equal_level_touch'::text
  ]));

COMMENT ON COLUMN entry_intents.trigger_event IS
  'CCIP-2026-0426A: structural trigger event for pending_zone_entry intents. '
  'Server monitor fires the trade when this event occurs inside the armed zone. '
  'NULL for immediate/wait_pullback/push_confirmation intents.';

-- 4. Drop and recreate RPC to return trigger_event (return type change requires DROP)
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
  session_status text,
  trigger_event text
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
$function$;

NOTIFY pgrst, 'reload schema';
