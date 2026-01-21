/*
  # Create Governance Alert System

  1. Overview
     - Automated alerting for SSOT violations
     - Configurable thresholds and channels
     - Rate limiting to prevent alert fatigue
     - Multi-channel delivery (push, in-app, email)

  2. New Tables
     - `governance_alert_config`
       - Stores alert configuration (thresholds, channels, rate limits)
       - Single row per config key
       - Admin-only updates
       
     - `governance_alerts`
       - Alert history with delivery tracking
       - Severity levels: CRITICAL, HIGH, MEDIUM, LOW
       - Read/dismissed tracking
       - Links to ssot_violations
       
     - `governance_alert_rate_limits`
       - Rate limiting per alert type
       - Cooldown tracking
       - Prevents alert spam

  3. Security
     - RLS enabled on all tables
     - Admin-only write access to config
     - Admin-only read access to alerts
     - Service role bypass for alert creation

  4. Indexes
     - Performance indexes on severity, created_at, alert_type
     - Fast lookups for unread alerts
     - Efficient rate limit checks
*/

-- =====================================================
-- 1. Alert Configuration Table
-- =====================================================

CREATE TABLE IF NOT EXISTS governance_alert_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key TEXT UNIQUE NOT NULL,
  config_value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Insert default configuration
INSERT INTO governance_alert_config (config_key, config_value) VALUES
('thresholds', '{
  "critical_compliance_score": 50,
  "high_violations_per_hour": 10,
  "component_health_critical": 50,
  "component_health_high": 70,
  "violation_spike_threshold": 10
}'::jsonb)
ON CONFLICT (config_key) DO NOTHING;

INSERT INTO governance_alert_config (config_key, config_value) VALUES
('channels', '{
  "push_enabled": true,
  "in_app_enabled": true,
  "email_enabled": false,
  "push_severity": ["CRITICAL", "HIGH"],
  "in_app_severity": ["CRITICAL", "HIGH", "MEDIUM", "LOW"]
}'::jsonb)
ON CONFLICT (config_key) DO NOTHING;

INSERT INTO governance_alert_config (config_key, config_value) VALUES
('rate_limits', '{
  "same_violation_cooldown_minutes": 30,
  "max_alerts_per_hour": 20,
  "aggregation_window_minutes": 5
}'::jsonb)
ON CONFLICT (config_key) DO NOTHING;

-- =====================================================
-- 2. Alert History Table
-- =====================================================

CREATE TABLE IF NOT EXISTS governance_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Alert identification
  alert_type TEXT NOT NULL,
  alert_key TEXT, -- For deduplication (e.g., "POSITION_SIZING_VIOLATION_entry-execution-coordinator")
  severity TEXT NOT NULL CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
  
  -- Alert content
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Related data
  violation_id UUID REFERENCES ssot_violations(id) ON DELETE SET NULL,
  component_name TEXT,
  
  -- Delivery tracking
  channels_sent TEXT[] DEFAULT ARRAY[]::TEXT[],
  sent_at TIMESTAMPTZ DEFAULT now(),
  delivery_status JSONB DEFAULT '{}'::jsonb, -- Track success/failure per channel
  
  -- Read/dismiss tracking
  read_by UUID[] DEFAULT ARRAY[]::UUID[],
  dismissed_by UUID[] DEFAULT ARRAY[]::UUID[],
  dismissed_at TIMESTAMPTZ,
  
  -- Action tracking
  action_url TEXT, -- Deep link to relevant page
  action_taken BOOLEAN DEFAULT false,
  action_taken_at TIMESTAMPTZ,
  action_taken_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_governance_alerts_severity ON governance_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_governance_alerts_created ON governance_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_governance_alerts_type ON governance_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_governance_alerts_key ON governance_alerts(alert_key) WHERE alert_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_governance_alerts_unread ON governance_alerts(created_at DESC) 
  WHERE dismissed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_governance_alerts_violation ON governance_alerts(violation_id) 
  WHERE violation_id IS NOT NULL;

-- =====================================================
-- 3. Rate Limiting Table
-- =====================================================

CREATE TABLE IF NOT EXISTS governance_alert_rate_limits (
  alert_key TEXT PRIMARY KEY,
  last_sent_at TIMESTAMPTZ NOT NULL,
  send_count INTEGER DEFAULT 1,
  cooldown_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alert_rate_limits_cooldown ON governance_alert_rate_limits(cooldown_until) 
  WHERE cooldown_until IS NOT NULL;

-- =====================================================
-- 4. RLS Policies
-- =====================================================

ALTER TABLE governance_alert_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_alert_rate_limits ENABLE ROW LEVEL SECURITY;

-- Alert Config Policies (Admin only)
CREATE POLICY "Admins can read alert config"
  ON governance_alert_config FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can update alert config"
  ON governance_alert_config FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- Service role can insert config
CREATE POLICY "Service role can manage alert config"
  ON governance_alert_config FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Alert History Policies (Admin only)
CREATE POLICY "Admins can read alerts"
  ON governance_alerts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can update alerts" 
  ON governance_alerts FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- Service role can create and manage alerts
CREATE POLICY "Service role can manage alerts"
  ON governance_alerts FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Rate Limiting Policies (Admin read, service write)
CREATE POLICY "Admins can read rate limits"
  ON governance_alert_rate_limits FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

CREATE POLICY "Service role can manage rate limits"
  ON governance_alert_rate_limits FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- 5. Helper Functions
-- =====================================================

-- Function to get unread alert count for admin
CREATE OR REPLACE FUNCTION get_unread_alert_count()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
  v_is_admin BOOLEAN;
BEGIN
  -- Check if user is admin
  SELECT is_admin INTO v_is_admin
  FROM user_profiles
  WHERE id = auth.uid();
  
  IF NOT COALESCE(v_is_admin, false) THEN
    RETURN 0;
  END IF;
  
  -- Count unread alerts
  SELECT COUNT(*)::INTEGER INTO v_count
  FROM governance_alerts
  WHERE dismissed_at IS NULL
  AND (
    read_by IS NULL 
    OR NOT (auth.uid() = ANY(read_by))
  );
  
  RETURN COALESCE(v_count, 0);
END;
$$;

-- Function to mark alert as read
CREATE OR REPLACE FUNCTION mark_alert_as_read(p_alert_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  -- Check if user is admin
  SELECT is_admin INTO v_is_admin
  FROM user_profiles
  WHERE id = auth.uid();
  
  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;
  
  -- Add user to read_by array if not already there
  UPDATE governance_alerts
  SET read_by = ARRAY(
    SELECT DISTINCT unnest(
      COALESCE(read_by, ARRAY[]::UUID[]) || ARRAY[auth.uid()]
    )
  )
  WHERE id = p_alert_id
  AND (read_by IS NULL OR NOT (auth.uid() = ANY(read_by)));
  
  RETURN FOUND;
END;
$$;

-- Function to dismiss alert
CREATE OR REPLACE FUNCTION dismiss_alert(p_alert_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  -- Check if user is admin
  SELECT is_admin INTO v_is_admin
  FROM user_profiles
  WHERE id = auth.uid();
  
  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;
  
  -- Mark alert as dismissed
  UPDATE governance_alerts
  SET 
    dismissed_by = ARRAY(
      SELECT DISTINCT unnest(
        COALESCE(dismissed_by, ARRAY[]::UUID[]) || ARRAY[auth.uid()]
      )
    ),
    dismissed_at = COALESCE(dismissed_at, now())
  WHERE id = p_alert_id
  AND dismissed_at IS NULL;
  
  RETURN FOUND;
END;
$$;

-- Function to check if alert should be rate limited
CREATE OR REPLACE FUNCTION check_alert_rate_limit(
  p_alert_key TEXT,
  p_cooldown_minutes INTEGER DEFAULT 30
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last_sent_at TIMESTAMPTZ;
  v_cooldown_until TIMESTAMPTZ;
BEGIN
  -- Get last sent time and cooldown
  SELECT last_sent_at, cooldown_until
  INTO v_last_sent_at, v_cooldown_until
  FROM governance_alert_rate_limits
  WHERE alert_key = p_alert_key;
  
  -- If no record exists, allow alert
  IF v_last_sent_at IS NULL THEN
    RETURN false; -- Not rate limited
  END IF;
  
  -- Check if still in cooldown
  IF v_cooldown_until IS NOT NULL AND v_cooldown_until > now() THEN
    RETURN true; -- Rate limited
  END IF;
  
  -- Check if enough time has passed
  IF v_last_sent_at + (p_cooldown_minutes || ' minutes')::INTERVAL > now() THEN
    RETURN true; -- Rate limited
  END IF;
  
  RETURN false; -- Not rate limited
END;
$$;

-- Function to record alert sent (update rate limit)
CREATE OR REPLACE FUNCTION record_alert_sent(p_alert_key TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO governance_alert_rate_limits (alert_key, last_sent_at)
  VALUES (p_alert_key, now())
  ON CONFLICT (alert_key) DO UPDATE
  SET 
    last_sent_at = now(),
    send_count = governance_alert_rate_limits.send_count + 1;
END;
$$;

-- =====================================================
-- 6. Realtime Enablement
-- =====================================================

-- Enable realtime for alerts so admins get instant updates
ALTER PUBLICATION supabase_realtime ADD TABLE governance_alerts;

-- =====================================================
-- 7. Comments
-- =====================================================

COMMENT ON TABLE governance_alert_config IS 'Configuration for governance alert system - thresholds, channels, rate limits';
COMMENT ON TABLE governance_alerts IS 'Alert history with delivery tracking and read/dismiss status';
COMMENT ON TABLE governance_alert_rate_limits IS 'Rate limiting to prevent alert spam';

COMMENT ON FUNCTION get_unread_alert_count() IS 'Returns count of unread alerts for current admin user';
COMMENT ON FUNCTION mark_alert_as_read(UUID) IS 'Marks an alert as read by current admin user';
COMMENT ON FUNCTION dismiss_alert(UUID) IS 'Dismisses an alert for current admin user';
COMMENT ON FUNCTION check_alert_rate_limit(TEXT, INTEGER) IS 'Checks if an alert should be rate limited';
COMMENT ON FUNCTION record_alert_sent(TEXT) IS 'Records that an alert was sent and updates rate limit';
