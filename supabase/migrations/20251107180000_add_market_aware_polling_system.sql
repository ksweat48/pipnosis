/*
  # Add Market-Aware Polling System

  1. Purpose
    - Enable automatic pause/resume of server-side polling based on Forex market hours
    - Track market status changes (open/close events)
    - Provide manual override controls for polling behavior
    - Monitor polling health with market status awareness

  2. New Tables
    - `market_status_log` - Tracks market open/close events and status changes
    - `polling_configuration` - Stores manual override settings for polling control

  3. New Views
    - `v_current_market_status` - Shows current market status and next status change
    - `v_polling_health_with_market` - Combines polling health with market status

  4. New Functions
    - `log_market_status_change()` - Records market status transitions
    - `get_current_market_status()` - Returns current market status (Open/Closed)
    - `set_polling_override()` - Enable/disable manual polling overrides
    - `get_polling_configuration()` - Get current polling configuration

  5. Security
    - Enable RLS on all new tables
    - Authenticated users can read all data
    - Only service_role and admins can modify polling configuration
    - Market status changes are logged automatically by cron jobs
*/

-- ============================================================================
-- 1. MARKET STATUS LOG TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS market_status_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status_change_timestamp timestamptz NOT NULL DEFAULT now(),
  previous_status text,
  new_status text NOT NULL CHECK (new_status IN ('Open', 'Closed')),
  day_of_week integer NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  hour_est integer NOT NULL CHECK (hour_est >= 0 AND hour_est <= 23),
  minute_est integer NOT NULL CHECK (minute_est >= 0 AND minute_est <= 59),
  detected_by text DEFAULT 'cron_job',
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_status_log_timestamp
  ON market_status_log(status_change_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_market_status_log_status
  ON market_status_log(new_status, status_change_timestamp DESC);

ALTER TABLE market_status_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read market status log"
  ON market_status_log
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can insert market status log"
  ON market_status_log
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- ============================================================================
-- 2. POLLING CONFIGURATION TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS polling_configuration (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key text UNIQUE NOT NULL,
  config_value jsonb NOT NULL,
  description text,
  modified_by uuid REFERENCES auth.users(id),
  modified_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_polling_config_key
  ON polling_configuration(config_key);

-- Insert default configuration
INSERT INTO polling_configuration (config_key, config_value, description)
VALUES
  ('force_polling_enabled', 'false'::jsonb, 'Force polling even when market is closed'),
  ('maintenance_mode', 'false'::jsonb, 'Temporarily disable all polling'),
  ('respect_market_hours', 'true'::jsonb, 'Automatically pause polling during market closure')
ON CONFLICT (config_key) DO NOTHING;

ALTER TABLE polling_configuration ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read polling config"
  ON polling_configuration
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can modify polling config"
  ON polling_configuration
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- 3. MARKET STATUS FUNCTIONS
-- ============================================================================

-- Function to calculate current market status
CREATE OR REPLACE FUNCTION get_current_market_status()
RETURNS TABLE (
  is_open boolean,
  status text,
  current_time_est timestamptz,
  day_of_week integer,
  hour_est integer,
  minute_est integer,
  next_change text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  now_est timestamptz;
  dow integer;
  hr integer;
  min integer;
  total_minutes integer;
  market_open boolean;
  next_event text;
BEGIN
  -- Get current time in EST
  now_est := (NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'America/New_York';

  dow := EXTRACT(DOW FROM now_est);
  hr := EXTRACT(HOUR FROM now_est);
  min := EXTRACT(MINUTE FROM now_est);
  total_minutes := hr * 60 + min;

  -- Check if market is open
  -- Market closes Friday 5:00 PM EST (17:00)
  -- Market opens Sunday 5:00 PM EST (17:00)
  market_open := true;
  next_event := 'Friday 5:00 PM EST (Market Close)';

  IF dow = 6 THEN
    -- Saturday - Market closed all day
    market_open := false;
    next_event := 'Sunday 5:00 PM EST (Market Open)';
  ELSIF dow = 5 AND total_minutes >= 1020 THEN
    -- Friday after 5:00 PM
    market_open := false;
    next_event := 'Sunday 5:00 PM EST (Market Open)';
  ELSIF dow = 0 AND total_minutes < 1020 THEN
    -- Sunday before 5:00 PM
    market_open := false;
    next_event := 'Sunday 5:00 PM EST (Market Open)';
  END IF;

  RETURN QUERY SELECT
    market_open,
    CASE WHEN market_open THEN 'Open' ELSE 'Closed' END,
    now_est,
    dow,
    hr,
    min,
    next_event;
END;
$$;

-- Function to log market status changes
CREATE OR REPLACE FUNCTION log_market_status_change()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_status record;
  last_logged_status text;
BEGIN
  -- Get current market status
  SELECT * INTO current_status FROM get_current_market_status() LIMIT 1;

  -- Get the most recent logged status
  SELECT new_status INTO last_logged_status
  FROM market_status_log
  ORDER BY status_change_timestamp DESC
  LIMIT 1;

  -- Only log if status has changed
  IF last_logged_status IS NULL OR last_logged_status != current_status.status THEN
    INSERT INTO market_status_log (
      status_change_timestamp,
      previous_status,
      new_status,
      day_of_week,
      hour_est,
      minute_est,
      detected_by,
      notes
    ) VALUES (
      current_status.current_time_est,
      last_logged_status,
      current_status.status,
      current_status.day_of_week,
      current_status.hour_est,
      current_status.minute_est,
      'automated_check',
      'Market status changed from ' || COALESCE(last_logged_status, 'Unknown') || ' to ' || current_status.status
    );

    RAISE NOTICE 'Market status changed: % -> %', COALESCE(last_logged_status, 'Unknown'), current_status.status;
  END IF;
END;
$$;

-- Function to get polling configuration value
CREATE OR REPLACE FUNCTION get_polling_config(key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  config_val jsonb;
BEGIN
  SELECT config_value INTO config_val
  FROM polling_configuration
  WHERE config_key = key;

  RETURN COALESCE(config_val, 'false'::jsonb);
END;
$$;

-- Function to set polling configuration
CREATE OR REPLACE FUNCTION set_polling_config(key text, value jsonb, modified_by_user uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO polling_configuration (config_key, config_value, modified_by, modified_at)
  VALUES (key, value, modified_by_user, now())
  ON CONFLICT (config_key)
  DO UPDATE SET
    config_value = EXCLUDED.config_value,
    modified_by = EXCLUDED.modified_by,
    modified_at = now();
END;
$$;

-- ============================================================================
-- 4. MONITORING VIEWS
-- ============================================================================

-- View: Current market status with configuration
CREATE OR REPLACE VIEW v_current_market_status AS
SELECT
  ms.is_open,
  ms.status,
  ms.current_time_est,
  ms.day_of_week,
  ms.hour_est,
  ms.minute_est,
  ms.next_change,
  (SELECT config_value::boolean FROM polling_configuration WHERE config_key = 'force_polling_enabled') as force_polling_enabled,
  (SELECT config_value::boolean FROM polling_configuration WHERE config_key = 'maintenance_mode') as maintenance_mode,
  (SELECT config_value::boolean FROM polling_configuration WHERE config_key = 'respect_market_hours') as respect_market_hours,
  CASE
    WHEN (SELECT config_value::boolean FROM polling_configuration WHERE config_key = 'maintenance_mode') THEN 'Maintenance Mode - Polling Disabled'
    WHEN (SELECT config_value::boolean FROM polling_configuration WHERE config_key = 'force_polling_enabled') THEN 'Force Enabled - Polling Active'
    WHEN ms.is_open THEN 'Market Open - Polling Active'
    ELSE 'Market Closed - Polling Paused'
  END as polling_status
FROM get_current_market_status() ms;

-- Grant select on views to authenticated users
GRANT SELECT ON v_current_market_status TO authenticated;

-- View: Polling health with market context
CREATE OR REPLACE VIEW v_polling_health_with_market AS
SELECT
  pph.id,
  pph.poll_timestamp,
  pph.successful_pairs,
  pph.failed_pairs,
  pph.total_duration_ms,
  pph.error_message,
  pph.created_at,
  ms.status as market_status_at_poll,
  ms.is_open as market_was_open,
  CASE
    WHEN pph.error_message LIKE '%Market closed%' THEN 'Market Closed - Expected'
    WHEN pph.successful_pairs = 0 AND pph.failed_pairs = 0 THEN 'No Polling - Market Closed'
    WHEN pph.successful_pairs > 0 THEN 'Success'
    WHEN pph.error_message IS NOT NULL THEN 'Error'
    ELSE 'Unknown'
  END as poll_result_category
FROM price_polling_health pph
CROSS JOIN LATERAL (
  SELECT * FROM get_current_market_status() LIMIT 1
) ms
ORDER BY pph.created_at DESC;

GRANT SELECT ON v_polling_health_with_market TO authenticated;

-- View: Market status change history
CREATE OR REPLACE VIEW v_market_status_history AS
SELECT
  id,
  status_change_timestamp,
  previous_status,
  new_status,
  day_of_week,
  CASE day_of_week
    WHEN 0 THEN 'Sunday'
    WHEN 1 THEN 'Monday'
    WHEN 2 THEN 'Tuesday'
    WHEN 3 THEN 'Wednesday'
    WHEN 4 THEN 'Thursday'
    WHEN 5 THEN 'Friday'
    WHEN 6 THEN 'Saturday'
  END as day_name,
  LPAD(hour_est::text, 2, '0') || ':' || LPAD(minute_est::text, 2, '0') as time_est,
  detected_by,
  notes,
  created_at
FROM market_status_log
ORDER BY status_change_timestamp DESC;

GRANT SELECT ON v_market_status_history TO authenticated;

-- ============================================================================
-- 5. SCHEDULE MARKET STATUS MONITORING
-- ============================================================================

-- Schedule market status check every 5 minutes to log status changes
SELECT cron.schedule(
  'market-status-monitor',
  '*/5 * * * *',
  'SELECT log_market_status_change();'
);

-- ============================================================================
-- 6. GRANT EXECUTE PERMISSIONS
-- ============================================================================

GRANT EXECUTE ON FUNCTION get_current_market_status() TO authenticated;
GRANT EXECUTE ON FUNCTION log_market_status_change() TO postgres;
GRANT EXECUTE ON FUNCTION get_polling_config(text) TO authenticated;
GRANT EXECUTE ON FUNCTION set_polling_config(text, jsonb, uuid) TO service_role;
