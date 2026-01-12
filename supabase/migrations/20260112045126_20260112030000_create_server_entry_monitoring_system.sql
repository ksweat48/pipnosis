/*
  # Server-Side Entry Intent Monitoring System

  This migration enables autonomous server-side monitoring of entry intents,
  eliminating browser tab visibility throttling issues.

  ## Changes

  1. New Fields on entry_intents
    - `execution_mode` - Track if browser or server is monitoring
    - `server_heartbeat` - Last server check timestamp
    - `server_last_check` - When server last evaluated conditions
    - `server_error` - Last error message from server monitoring

  2. New Table: entry_intent_server_state
    - Tracks detailed server monitoring state per intent
    - Records check history, decisions, and consecutive errors
    - Enables health monitoring and debugging

  3. New Function: get_intents_for_server_monitoring()
    - Returns all active monitoring intents for server processing
    - Includes price data and session context
    - Service role access for scheduled function

  4. Health Monitoring
    - Detect stale intents (no heartbeat for 2+ minutes)
    - Auto-recovery mechanisms
    - Error tracking and alerts

  ## Security
    - RLS enabled on new table
    - Service role grants for scheduled function
    - Authenticated user access for monitoring data
*/

-- Add server monitoring fields to entry_intents
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'execution_mode'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN execution_mode text DEFAULT 'server'
      CHECK (execution_mode IN ('browser', 'server'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'server_heartbeat'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN server_heartbeat timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'server_last_check'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN server_last_check timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'server_error'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN server_error text;
  END IF;
END $$;

-- Create entry_intent_server_state table for detailed tracking
CREATE TABLE IF NOT EXISTS entry_intent_server_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id uuid NOT NULL REFERENCES entry_intents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_processed_at timestamptz NOT NULL DEFAULT now(),
  last_price_checked decimal(10, 5),
  last_eqs_score decimal(5, 2),
  last_decision text,
  consecutive_checks integer NOT NULL DEFAULT 0,
  consecutive_errors integer NOT NULL DEFAULT 0,
  last_error text,
  last_error_at timestamptz,
  total_checks integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on entry_intent_server_state
ALTER TABLE entry_intent_server_state ENABLE ROW LEVEL SECURITY;

-- RLS Policies for entry_intent_server_state
CREATE POLICY "Users can view own server state"
  ON entry_intent_server_state FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage all server state"
  ON entry_intent_server_state FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_entry_intent_server_state_intent_id
  ON entry_intent_server_state(intent_id);

CREATE INDEX IF NOT EXISTS idx_entry_intent_server_state_user_id
  ON entry_intent_server_state(user_id);

-- Function to get all active entry intents for server monitoring
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
    ei.alpha_confidence,
    ei.alpha_reasoning,
    ei.market_context,
    ei.status::text,
    ei.created_at,
    ei.execution_mode,
    ei.server_heartbeat,
    ei.urgency_phase,
    ei.zone_tolerance_pips,
    ei.time_adjusted_threshold,
    ei.zone_type,
    ei.micro_regime_used,
    ei.primary_zone_min,
    ei.primary_zone_max,
    ei.secondary_zone_min,
    ei.secondary_zone_max,
    ei.zone_reachability_distance_pips,
    ei.position_size_multiplier,
    ei.last_checked_at,
    rp.price,
    rp.updated_at
  FROM entry_intents ei
  LEFT JOIN LATERAL (
    SELECT price, updated_at
    FROM realtime_prices
    WHERE symbol = ei.symbol
    ORDER BY updated_at DESC
    LIMIT 1
  ) rp ON true
  WHERE ei.status = 'monitoring'
    AND ei.execution_mode = 'server'
    AND (ei.timeout_at IS NULL OR ei.timeout_at > now())
  ORDER BY ei.created_at ASC;
END;
$$;

-- Function to update server heartbeat
CREATE OR REPLACE FUNCTION update_intent_server_heartbeat(
  p_intent_id uuid,
  p_instance_id text DEFAULT 'netlify-entry-monitor'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE entry_intents
  SET
    server_heartbeat = now(),
    server_last_check = now()
  WHERE id = p_intent_id;
END;
$$;

-- Function to detect and mark stale intents for recovery
CREATE OR REPLACE FUNCTION mark_stale_entry_intents()
RETURNS TABLE (
  intent_id uuid,
  symbol text,
  minutes_stale integer
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Mark intents with no server heartbeat for 3+ minutes as needing browser fallback
  UPDATE entry_intents
  SET
    execution_mode = 'browser',
    server_error = 'Server monitoring stale - switched to browser fallback'
  WHERE status = 'monitoring'
    AND execution_mode = 'server'
    AND (
      server_heartbeat IS NULL
      OR server_heartbeat < now() - interval '3 minutes'
    )
  RETURNING
    id,
    symbol,
    EXTRACT(EPOCH FROM (now() - COALESCE(server_heartbeat, created_at))) / 60 AS minutes_stale;

  RETURN QUERY
  SELECT
    id,
    ei.symbol,
    EXTRACT(EPOCH FROM (now() - COALESCE(server_heartbeat, created_at)))::integer / 60
  FROM entry_intents ei
  WHERE execution_mode = 'browser'
    AND server_error LIKE '%stale%';
END;
$$;

-- Grant execute permissions to service role
GRANT EXECUTE ON FUNCTION get_intents_for_server_monitoring() TO service_role;
GRANT EXECUTE ON FUNCTION update_intent_server_heartbeat(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION mark_stale_entry_intents() TO service_role;

-- Also grant to authenticated for debugging/monitoring
GRANT EXECUTE ON FUNCTION get_intents_for_server_monitoring() TO authenticated;
GRANT EXECUTE ON FUNCTION update_intent_server_heartbeat(uuid, text) TO authenticated;

-- Enable realtime for entry_intent_server_state (for admin monitoring)
ALTER PUBLICATION supabase_realtime ADD TABLE entry_intent_server_state;

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_entry_intent_server_state_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_entry_intent_server_state_timestamp
  BEFORE UPDATE ON entry_intent_server_state
  FOR EACH ROW
  EXECUTE FUNCTION update_entry_intent_server_state_timestamp();

-- Add comment for documentation
COMMENT ON TABLE entry_intent_server_state IS 'Tracks server-side monitoring state for each entry intent to enable health monitoring and debugging';
COMMENT ON FUNCTION get_intents_for_server_monitoring() IS 'Returns all active entry intents that need server-side monitoring with current price data';
COMMENT ON FUNCTION mark_stale_entry_intents() IS 'Detects intents with stale server heartbeats and switches them to browser fallback mode';
