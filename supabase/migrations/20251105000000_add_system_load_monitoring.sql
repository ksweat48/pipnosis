/*
  # Add System Load Monitoring Tables

  1. New Tables
    - `system_load_metrics`
      - `id` (uuid, primary key) - Unique identifier
      - `timestamp` (timestamptz) - When the metric was recorded
      - `cpu_credits_used` (integer) - CPU credits used in measurement period
      - `cpu_credits_limit` (integer) - CPU credits limit for period
      - `cpu_usage_percentage` (numeric) - Percentage of CPU credits used
      - `api_calls_count` (integer) - Number of API calls made
      - `api_calls_per_second` (numeric) - API call rate
      - `active_pairs_count` (integer) - Number of actively polled pairs
      - `error_count` (integer) - Number of errors in period
      - `error_rate` (numeric) - Percentage of failed requests
      - `request_queue_length` (integer) - Current queue depth
      - `cache_hit_rate` (numeric) - Cache effectiveness percentage
      - `db_writes_per_minute` (integer) - Database write operations
      - `created_at` (timestamptz) - Record creation timestamp

    - `system_load_alerts`
      - `id` (uuid, primary key) - Unique identifier
      - `alert_type` (text) - Type of alert (rate_limit_warning, high_error_rate, etc.)
      - `severity` (text) - Severity level (info, warning, critical)
      - `threshold_value` (numeric) - Threshold that was exceeded
      - `actual_value` (numeric) - Actual value that triggered alert
      - `message` (text) - Human-readable alert message
      - `metadata` (jsonb) - Additional context data
      - `email_sent` (boolean) - Whether email notification was sent
      - `email_sent_at` (timestamptz) - When email was sent
      - `resolved` (boolean) - Whether alert condition has been resolved
      - `resolved_at` (timestamptz) - When alert was resolved
      - `created_at` (timestamptz) - Record creation timestamp

    - `symbol_load_metrics`
      - `id` (uuid, primary key) - Unique identifier
      - `timestamp` (timestamptz) - When the metric was recorded
      - `symbol` (text) - Trading pair symbol
      - `api_calls_count` (integer) - API calls for this symbol
      - `error_count` (integer) - Errors for this symbol
      - `avg_response_time_ms` (integer) - Average response time
      - `last_successful_poll` (timestamptz) - Last successful price update
      - `polling_interval_ms` (integer) - Current polling interval
      - `priority` (text) - Current priority level
      - `created_at` (timestamptz) - Record creation timestamp

  2. Indexes
    - Index on timestamp for time-series queries
    - Index on symbol and timestamp for per-symbol analysis
    - Index on alert_type and resolved for active alerts
    - Partial index on unresolved alerts for quick filtering

  3. Security
    - Enable RLS on all tables
    - Only authenticated users can read metrics
    - Only service role can write metrics
    - Admin users can manage alerts

  4. Data Retention
    - Auto-delete system_load_metrics older than 30 days
    - Keep symbol_load_metrics for 14 days
    - Keep alerts indefinitely for historical analysis

  5. Functions
    - Function to record system load snapshot
    - Function to check thresholds and create alerts
    - Function to send email notifications for alerts
    - Function to clean up old metrics
*/

-- Create system_load_metrics table
CREATE TABLE IF NOT EXISTS system_load_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp timestamptz NOT NULL DEFAULT now(),
  cpu_credits_used integer NOT NULL DEFAULT 0,
  cpu_credits_limit integer NOT NULL DEFAULT 5000,
  cpu_usage_percentage numeric(5, 2) NOT NULL DEFAULT 0,
  api_calls_count integer NOT NULL DEFAULT 0,
  api_calls_per_second numeric(6, 2) NOT NULL DEFAULT 0,
  active_pairs_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  error_rate numeric(5, 2) NOT NULL DEFAULT 0,
  request_queue_length integer NOT NULL DEFAULT 0,
  cache_hit_rate numeric(5, 2) NOT NULL DEFAULT 0,
  db_writes_per_minute integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Create system_load_alerts table
CREATE TABLE IF NOT EXISTS system_load_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  threshold_value numeric NOT NULL,
  actual_value numeric NOT NULL,
  message text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  email_sent boolean DEFAULT false,
  email_sent_at timestamptz,
  resolved boolean DEFAULT false,
  resolved_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Create symbol_load_metrics table
CREATE TABLE IF NOT EXISTS symbol_load_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp timestamptz NOT NULL DEFAULT now(),
  symbol text NOT NULL,
  api_calls_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  avg_response_time_ms integer NOT NULL DEFAULT 0,
  last_successful_poll timestamptz,
  polling_interval_ms integer NOT NULL DEFAULT 2000,
  priority text NOT NULL DEFAULT 'normal',
  created_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_system_load_metrics_timestamp
  ON system_load_metrics(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_symbol_load_metrics_symbol_timestamp
  ON symbol_load_metrics(symbol, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_system_load_alerts_type_resolved
  ON system_load_alerts(alert_type, resolved);

CREATE INDEX IF NOT EXISTS idx_system_load_alerts_unresolved
  ON system_load_alerts(created_at DESC) WHERE NOT resolved;

CREATE INDEX IF NOT EXISTS idx_system_load_alerts_severity
  ON system_load_alerts(severity, created_at DESC);

-- Enable Row Level Security
ALTER TABLE system_load_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_load_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE symbol_load_metrics ENABLE ROW LEVEL SECURITY;

-- RLS Policies for system_load_metrics
CREATE POLICY "Authenticated users can read system load metrics"
  ON system_load_metrics
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can insert system load metrics"
  ON system_load_metrics
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can delete old metrics"
  ON system_load_metrics
  FOR DELETE
  TO service_role
  USING (true);

-- RLS Policies for system_load_alerts
CREATE POLICY "Authenticated users can read alerts"
  ON system_load_alerts
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can manage alerts"
  ON system_load_alerts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- RLS Policies for symbol_load_metrics
CREATE POLICY "Authenticated users can read symbol metrics"
  ON symbol_load_metrics
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can insert symbol metrics"
  ON symbol_load_metrics
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can delete old symbol metrics"
  ON symbol_load_metrics
  FOR DELETE
  TO service_role
  USING (true);

-- Function to record system load snapshot
CREATE OR REPLACE FUNCTION record_system_load_snapshot(
  p_cpu_credits_used integer,
  p_cpu_credits_limit integer,
  p_api_calls_count integer,
  p_active_pairs_count integer,
  p_error_count integer,
  p_request_queue_length integer,
  p_cache_hit_rate numeric,
  p_db_writes_per_minute integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_metric_id uuid;
  v_cpu_usage_percentage numeric;
  v_error_rate numeric;
  v_api_calls_per_second numeric;
BEGIN
  -- Calculate derived metrics
  v_cpu_usage_percentage := ROUND((p_cpu_credits_used::numeric / p_cpu_credits_limit::numeric) * 100, 2);
  v_error_rate := CASE
    WHEN p_api_calls_count > 0 THEN ROUND((p_error_count::numeric / p_api_calls_count::numeric) * 100, 2)
    ELSE 0
  END;
  v_api_calls_per_second := ROUND(p_api_calls_count::numeric / 60, 2);

  -- Insert metric record
  INSERT INTO system_load_metrics (
    cpu_credits_used,
    cpu_credits_limit,
    cpu_usage_percentage,
    api_calls_count,
    api_calls_per_second,
    active_pairs_count,
    error_count,
    error_rate,
    request_queue_length,
    cache_hit_rate,
    db_writes_per_minute
  ) VALUES (
    p_cpu_credits_used,
    p_cpu_credits_limit,
    v_cpu_usage_percentage,
    p_api_calls_count,
    v_api_calls_per_second,
    p_active_pairs_count,
    p_error_count,
    v_error_rate,
    p_request_queue_length,
    p_cache_hit_rate,
    p_db_writes_per_minute
  )
  RETURNING id INTO v_metric_id;

  -- Check for alert conditions
  PERFORM check_system_load_thresholds(v_metric_id);

  RETURN v_metric_id;
END;
$$;

-- Function to check thresholds and create alerts
CREATE OR REPLACE FUNCTION check_system_load_thresholds(p_metric_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_metric record;
  v_existing_alert record;
BEGIN
  -- Get the metric
  SELECT * INTO v_metric
  FROM system_load_metrics
  WHERE id = p_metric_id;

  -- Check CPU usage threshold (70%, 85%, 95%)
  IF v_metric.cpu_usage_percentage >= 70 THEN
    -- Check if there's already an active alert
    SELECT * INTO v_existing_alert
    FROM system_load_alerts
    WHERE alert_type = 'cpu_usage_high'
      AND NOT resolved
      AND created_at > now() - interval '15 minutes'
    ORDER BY created_at DESC
    LIMIT 1;

    -- Only create new alert if no recent unresolved alert exists
    IF v_existing_alert IS NULL THEN
      INSERT INTO system_load_alerts (
        alert_type,
        severity,
        threshold_value,
        actual_value,
        message,
        metadata
      ) VALUES (
        'cpu_usage_high',
        CASE
          WHEN v_metric.cpu_usage_percentage >= 95 THEN 'critical'
          WHEN v_metric.cpu_usage_percentage >= 85 THEN 'warning'
          ELSE 'info'
        END,
        CASE
          WHEN v_metric.cpu_usage_percentage >= 95 THEN 95
          WHEN v_metric.cpu_usage_percentage >= 85 THEN 85
          ELSE 70
        END,
        v_metric.cpu_usage_percentage,
        format('MetaAPI CPU usage at %s%% (threshold: %s%%)',
          v_metric.cpu_usage_percentage,
          CASE
            WHEN v_metric.cpu_usage_percentage >= 95 THEN '95'
            WHEN v_metric.cpu_usage_percentage >= 85 THEN '85'
            ELSE '70'
          END
        ),
        jsonb_build_object(
          'metric_id', p_metric_id,
          'cpu_credits_used', v_metric.cpu_credits_used,
          'cpu_credits_limit', v_metric.cpu_credits_limit,
          'api_calls_count', v_metric.api_calls_count,
          'active_pairs', v_metric.active_pairs_count
        )
      );
    END IF;
  END IF;

  -- Check error rate threshold (10%)
  IF v_metric.error_rate >= 10 THEN
    SELECT * INTO v_existing_alert
    FROM system_load_alerts
    WHERE alert_type = 'error_rate_high'
      AND NOT resolved
      AND created_at > now() - interval '15 minutes'
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_existing_alert IS NULL THEN
      INSERT INTO system_load_alerts (
        alert_type,
        severity,
        threshold_value,
        actual_value,
        message,
        metadata
      ) VALUES (
        'error_rate_high',
        'warning',
        10,
        v_metric.error_rate,
        format('High error rate detected: %s%% of API calls failing', v_metric.error_rate),
        jsonb_build_object(
          'metric_id', p_metric_id,
          'error_count', v_metric.error_count,
          'api_calls_count', v_metric.api_calls_count
        )
      );
    END IF;
  END IF;

  -- Auto-resolve alerts if conditions have improved
  UPDATE system_load_alerts
  SET resolved = true,
      resolved_at = now()
  WHERE alert_type = 'cpu_usage_high'
    AND NOT resolved
    AND v_metric.cpu_usage_percentage < 60;

  UPDATE system_load_alerts
  SET resolved = true,
      resolved_at = now()
  WHERE alert_type = 'error_rate_high'
    AND NOT resolved
    AND v_metric.error_rate < 5;
END;
$$;

-- Function to clean up old metrics
CREATE OR REPLACE FUNCTION cleanup_old_system_metrics()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Delete system load metrics older than 30 days
  DELETE FROM system_load_metrics
  WHERE created_at < now() - interval '30 days';

  -- Delete symbol load metrics older than 14 days
  DELETE FROM symbol_load_metrics
  WHERE created_at < now() - interval '14 days';

  -- Keep all alerts for historical analysis (no deletion)
END;
$$;

-- Function to get current system load summary
CREATE OR REPLACE FUNCTION get_system_load_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_recent_metric record;
  v_avg_cpu_1h numeric;
  v_avg_cpu_24h numeric;
  v_active_alerts integer;
  v_result jsonb;
BEGIN
  -- Get most recent metric
  SELECT * INTO v_recent_metric
  FROM system_load_metrics
  ORDER BY timestamp DESC
  LIMIT 1;

  -- Get average CPU usage last hour
  SELECT AVG(cpu_usage_percentage) INTO v_avg_cpu_1h
  FROM system_load_metrics
  WHERE timestamp > now() - interval '1 hour';

  -- Get average CPU usage last 24 hours
  SELECT AVG(cpu_usage_percentage) INTO v_avg_cpu_24h
  FROM system_load_metrics
  WHERE timestamp > now() - interval '24 hours';

  -- Count active alerts
  SELECT COUNT(*) INTO v_active_alerts
  FROM system_load_alerts
  WHERE NOT resolved;

  -- Build result
  v_result := jsonb_build_object(
    'current', jsonb_build_object(
      'cpu_usage_percentage', COALESCE(v_recent_metric.cpu_usage_percentage, 0),
      'api_calls_per_second', COALESCE(v_recent_metric.api_calls_per_second, 0),
      'error_rate', COALESCE(v_recent_metric.error_rate, 0),
      'active_pairs', COALESCE(v_recent_metric.active_pairs_count, 0),
      'queue_length', COALESCE(v_recent_metric.request_queue_length, 0),
      'cache_hit_rate', COALESCE(v_recent_metric.cache_hit_rate, 0)
    ),
    'averages', jsonb_build_object(
      'cpu_usage_1h', COALESCE(ROUND(v_avg_cpu_1h, 2), 0),
      'cpu_usage_24h', COALESCE(ROUND(v_avg_cpu_24h, 2), 0)
    ),
    'active_alerts', v_active_alerts,
    'last_updated', COALESCE(v_recent_metric.timestamp, now())
  );

  RETURN v_result;
END;
$$;

-- Function to trigger email alert for new system alerts
CREATE OR REPLACE FUNCTION trigger_alert_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only send email for unresolved, high-severity alerts
  IF NEW.resolved = false AND NEW.severity IN ('warning', 'critical') THEN
    -- Use pg_notify to trigger edge function call
    -- The edge function will be called by a listener service
    PERFORM pg_notify(
      'system_alert_created',
      json_build_object(
        'alert_id', NEW.id,
        'alert_type', NEW.alert_type,
        'severity', NEW.severity,
        'message', NEW.message,
        'threshold_value', NEW.threshold_value,
        'actual_value', NEW.actual_value,
        'metadata', NEW.metadata
      )::text
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger for alert email notifications
DROP TRIGGER IF EXISTS system_load_alert_email_trigger ON system_load_alerts;
CREATE TRIGGER system_load_alert_email_trigger
  AFTER INSERT ON system_load_alerts
  FOR EACH ROW
  EXECUTE FUNCTION trigger_alert_email();
