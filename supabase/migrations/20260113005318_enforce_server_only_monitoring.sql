/*
  # Enforce Server-Only Entry Monitoring

  ## Problem
  Browser-based fallback monitoring fails due to tab throttling (30s timeout)
  causing intents to be abandoned with MONITORING_STALLED errors.

  ## Solution
  1. Disable automatic browser fallback - alert instead
  2. Add server monitoring health tracking
  3. Enforce server-only execution mode
  4. Add alerting when server monitoring degrades
  5. Track server function health metrics

  ## Changes
  1. Server Health Tracking Table
    - Track server function execution success/failures
    - Monitor price data freshness issues
    - Alert on consecutive failures

  2. Modified mark_stale_entry_intents()
    - NO LONGER switches to browser mode
    - Creates alert notification instead
    - Logs to health tracking table

  3. New Function: log_server_monitoring_health()
    - Records each server monitoring cycle
    - Tracks success/failure rates
    - Enables debugging and alerting

  ## Security
  - RLS enabled on new tables
  - Service role access for monitoring functions
*/

-- Create server monitoring health table
CREATE TABLE IF NOT EXISTS server_monitoring_health (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_timestamp timestamptz NOT NULL DEFAULT now(),
  total_intents_checked integer NOT NULL DEFAULT 0,
  successful_checks integer NOT NULL DEFAULT 0,
  failed_checks integer NOT NULL DEFAULT 0,
  executed_trades integer NOT NULL DEFAULT 0,
  abandoned_intents integer NOT NULL DEFAULT 0,
  stale_price_count integer NOT NULL DEFAULT 0,
  execution_duration_ms integer NOT NULL,
  errors jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE server_monitoring_health ENABLE ROW LEVEL SECURITY;

-- RLS: Service role can write, authenticated can read
CREATE POLICY "Service role can write health data"
  ON server_monitoring_health FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Authenticated users can read health data"
  ON server_monitoring_health FOR SELECT
  TO authenticated
  USING (true);

-- Index for recent health queries
CREATE INDEX IF NOT EXISTS idx_server_monitoring_health_timestamp
  ON server_monitoring_health(check_timestamp DESC);

-- Create server monitoring alerts table
CREATE TABLE IF NOT EXISTS server_monitoring_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type text NOT NULL CHECK (alert_type IN (
    'SERVER_STALE',
    'CONSECUTIVE_FAILURES',
    'PRICE_DATA_STALE',
    'FUNCTION_TIMEOUT',
    'CRITICAL_ERROR'
  )),
  severity text NOT NULL CHECK (severity IN ('warning', 'error', 'critical')),
  intent_id uuid REFERENCES entry_intents(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid REFERENCES goal_sessions(id) ON DELETE CASCADE,
  message text NOT NULL,
  details jsonb DEFAULT '{}'::jsonb,
  acknowledged boolean NOT NULL DEFAULT false,
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE server_monitoring_alerts ENABLE ROW LEVEL SECURITY;

-- RLS: Users see their own alerts
CREATE POLICY "Users can view own alerts"
  ON server_monitoring_alerts FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can acknowledge own alerts"
  ON server_monitoring_alerts FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role can manage all alerts"
  ON server_monitoring_alerts FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_server_monitoring_alerts_user
  ON server_monitoring_alerts(user_id, acknowledged) WHERE NOT acknowledged;

CREATE INDEX IF NOT EXISTS idx_server_monitoring_alerts_intent
  ON server_monitoring_alerts(intent_id);

-- Enable realtime for alerts
ALTER PUBLICATION supabase_realtime ADD TABLE server_monitoring_alerts;

-- Function to log server monitoring health
CREATE OR REPLACE FUNCTION log_server_monitoring_health(
  p_total_intents integer,
  p_successful integer,
  p_failed integer,
  p_executed integer,
  p_abandoned integer,
  p_stale_price integer,
  p_duration_ms integer,
  p_errors jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_health_id uuid;
BEGIN
  INSERT INTO server_monitoring_health (
    check_timestamp,
    total_intents_checked,
    successful_checks,
    failed_checks,
    executed_trades,
    abandoned_intents,
    stale_price_count,
    execution_duration_ms,
    errors
  ) VALUES (
    now(),
    p_total_intents,
    p_successful,
    p_failed,
    p_executed,
    p_abandoned,
    p_stale_price,
    p_duration_ms,
    p_errors
  )
  RETURNING id INTO v_health_id;

  RETURN v_health_id;
END;
$$;

-- Drop old function and recreate with new signature
DROP FUNCTION IF EXISTS mark_stale_entry_intents();

-- CRITICAL: Rewrite mark_stale_entry_intents to ALERT instead of switching to browser
CREATE OR REPLACE FUNCTION mark_stale_entry_intents()
RETURNS TABLE (
  intent_id uuid,
  symbol text,
  minutes_stale integer,
  action text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_stale_intent RECORD;
BEGIN
  -- Find stale intents (no heartbeat for 3+ minutes)
  FOR v_stale_intent IN
    SELECT
      ei.id,
      ei.symbol,
      ei.user_id,
      ei.session_id,
      EXTRACT(EPOCH FROM (now() - COALESCE(ei.server_heartbeat, ei.created_at)))::integer / 60 AS minutes_stale
    FROM entry_intents ei
    WHERE ei.status = 'monitoring'
      AND ei.execution_mode = 'server'
      AND (
        ei.server_heartbeat IS NULL
        OR ei.server_heartbeat < now() - interval '3 minutes'
      )
  LOOP
    -- Create ALERT instead of switching to browser mode
    INSERT INTO server_monitoring_alerts (
      alert_type,
      severity,
      intent_id,
      user_id,
      session_id,
      message,
      details
    ) VALUES (
      'SERVER_STALE',
      'critical',
      v_stale_intent.id,
      v_stale_intent.user_id,
      v_stale_intent.session_id,
      'Server monitoring has stopped for ' || v_stale_intent.symbol || '. Intent monitoring may be paused.',
      jsonb_build_object(
        'minutes_stale', v_stale_intent.minutes_stale,
        'symbol', v_stale_intent.symbol,
        'recommended_action', 'Check server function health or manually execute'
      )
    );

    -- Update intent with error flag (but keep in server mode)
    UPDATE entry_intents
    SET
      server_error = 'Server heartbeat stale for ' || v_stale_intent.minutes_stale || ' minutes - monitoring may be paused'
    WHERE id = v_stale_intent.id;

    -- Return the stale intent info
    RETURN QUERY
    SELECT
      v_stale_intent.id,
      v_stale_intent.symbol,
      v_stale_intent.minutes_stale,
      'ALERTED'::text;
  END LOOP;

  RETURN;
END;
$$;

-- Function to check server monitoring health status
CREATE OR REPLACE FUNCTION get_server_monitoring_health_status()
RETURNS TABLE (
  is_healthy boolean,
  last_check_age_seconds integer,
  recent_success_rate decimal,
  active_alerts integer,
  details jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_last_check timestamptz;
  v_success_rate decimal;
  v_alert_count integer;
  v_is_healthy boolean;
BEGIN
  -- Get most recent health check
  SELECT check_timestamp INTO v_last_check
  FROM server_monitoring_health
  ORDER BY check_timestamp DESC
  LIMIT 1;

  -- Calculate success rate over last 10 checks
  SELECT
    CASE
      WHEN SUM(total_intents_checked) > 0
      THEN (SUM(successful_checks)::decimal / SUM(total_intents_checked)) * 100
      ELSE 100
    END INTO v_success_rate
  FROM (
    SELECT successful_checks, total_intents_checked
    FROM server_monitoring_health
    ORDER BY check_timestamp DESC
    LIMIT 10
  ) recent_checks;

  -- Count active alerts
  SELECT COUNT(*) INTO v_alert_count
  FROM server_monitoring_alerts
  WHERE NOT acknowledged
    AND created_at > now() - interval '1 hour';

  -- Determine health status
  v_is_healthy := (
    v_last_check IS NOT NULL
    AND v_last_check > now() - interval '5 minutes'
    AND COALESCE(v_success_rate, 100) > 80
    AND v_alert_count = 0
  );

  RETURN QUERY
  SELECT
    v_is_healthy,
    EXTRACT(EPOCH FROM (now() - COALESCE(v_last_check, now() - interval '1 hour')))::integer,
    COALESCE(v_success_rate, 100),
    COALESCE(v_alert_count, 0),
    jsonb_build_object(
      'last_check_timestamp', v_last_check,
      'status', CASE WHEN v_is_healthy THEN 'healthy' ELSE 'degraded' END,
      'recommendation',
      CASE
        WHEN v_last_check IS NULL THEN 'Server monitoring has never run'
        WHEN v_last_check < now() - interval '5 minutes' THEN 'Server monitoring appears stalled'
        WHEN v_success_rate < 80 THEN 'Server monitoring has high failure rate'
        WHEN v_alert_count > 0 THEN 'Active monitoring alerts present'
        ELSE 'All systems operational'
      END
    );
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION log_server_monitoring_health(integer, integer, integer, integer, integer, integer, integer, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION mark_stale_entry_intents() TO service_role;
GRANT EXECUTE ON FUNCTION get_server_monitoring_health_status() TO authenticated;
GRANT EXECUTE ON FUNCTION get_server_monitoring_health_status() TO service_role;

-- Add column to track server monitoring failures per intent
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'consecutive_server_failures'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN consecutive_server_failures integer NOT NULL DEFAULT 0;
  END IF;
END $$;

-- Create index on consecutive failures
CREATE INDEX IF NOT EXISTS idx_entry_intents_server_failures
  ON entry_intents(consecutive_server_failures) WHERE consecutive_server_failures > 0;

-- Add comments
COMMENT ON TABLE server_monitoring_health IS 'Tracks health metrics for each server monitoring cycle - enables alerting and debugging';
COMMENT ON TABLE server_monitoring_alerts IS 'Critical alerts when server monitoring degrades or fails - users must acknowledge';
COMMENT ON FUNCTION mark_stale_entry_intents() IS 'CRITICAL: Creates alerts for stale intents instead of switching to browser fallback (prevents MONITORING_STALLED errors)';
COMMENT ON FUNCTION get_server_monitoring_health_status() IS 'Returns current health status of server monitoring system';
