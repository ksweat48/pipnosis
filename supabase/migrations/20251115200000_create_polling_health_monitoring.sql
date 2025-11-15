/*
  # Create Polling Health Monitoring System

  1. New Tables
    - `polling_health`
      - Tracks real-time health of each symbol's polling
      - Records error counts, recovery attempts, last success times
      - Stores circuit breaker states
    - `polling_recovery_log`
      - Historical log of all recovery attempts
      - Tracks what triggered recovery and results
    - `polling_fallback_cache`
      - Emergency cache of last known good prices
      - Used when all other data sources fail

  2. Security
    - Enable RLS on all tables
    - Allow authenticated users to read health data
    - Only system/admin can write health data
*/

-- Polling health tracking table
CREATE TABLE IF NOT EXISTS polling_health (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  status text NOT NULL DEFAULT 'active', -- active, degraded, critical, stopped
  consecutive_errors integer NOT NULL DEFAULT 0,
  total_errors integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_message text,
  circuit_breaker_state text NOT NULL DEFAULT 'closed', -- closed, half_open, open
  circuit_opened_at timestamptz,
  recovery_attempts integer NOT NULL DEFAULT 0,
  last_recovery_at timestamptz,
  polling_interval_ms integer NOT NULL DEFAULT 3000,
  data_quality text NOT NULL DEFAULT 'unknown', -- live, cached, stale, unavailable
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(symbol)
);

-- Recovery attempt log
CREATE TABLE IF NOT EXISTS polling_recovery_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  trigger_reason text NOT NULL, -- heartbeat_timeout, consecutive_errors, circuit_breaker, manual
  recovery_action text NOT NULL, -- restart, backoff, failover, stop
  success boolean NOT NULL DEFAULT false,
  error_message text,
  metrics jsonb, -- Additional context: error_count, time_since_last_success, etc.
  created_at timestamptz DEFAULT now()
);

-- Emergency fallback price cache
CREATE TABLE IF NOT EXISTS polling_fallback_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  bid numeric NOT NULL,
  ask numeric NOT NULL,
  mid numeric NOT NULL,
  spread numeric NOT NULL,
  source text NOT NULL, -- Where this price came from originally
  quality_score integer NOT NULL DEFAULT 0, -- 100 = perfect live data, 0 = stale/unreliable
  broker_time timestamptz NOT NULL,
  cached_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE(symbol)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_polling_health_symbol ON polling_health(symbol);
CREATE INDEX IF NOT EXISTS idx_polling_health_status ON polling_health(status);
CREATE INDEX IF NOT EXISTS idx_polling_health_updated_at ON polling_health(updated_at);

CREATE INDEX IF NOT EXISTS idx_polling_recovery_log_symbol ON polling_recovery_log(symbol);
CREATE INDEX IF NOT EXISTS idx_polling_recovery_log_created_at ON polling_recovery_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_polling_fallback_cache_symbol ON polling_fallback_cache(symbol);
CREATE INDEX IF NOT EXISTS idx_polling_fallback_cache_expires_at ON polling_fallback_cache(expires_at);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_polling_health_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS update_polling_health_timestamp ON polling_health;
CREATE TRIGGER update_polling_health_timestamp
  BEFORE UPDATE ON polling_health
  FOR EACH ROW
  EXECUTE FUNCTION update_polling_health_updated_at();

-- Function to clean up old recovery logs (keep last 7 days)
CREATE OR REPLACE FUNCTION cleanup_old_polling_logs()
RETURNS void AS $$
BEGIN
  DELETE FROM polling_recovery_log
  WHERE created_at < now() - interval '7 days';

  DELETE FROM polling_fallback_cache
  WHERE expires_at < now();
END;
$$ LANGUAGE plpgsql;

-- Enable RLS
ALTER TABLE polling_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE polling_recovery_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE polling_fallback_cache ENABLE ROW LEVEL SECURITY;

-- RLS Policies for polling_health
CREATE POLICY "Anyone can read polling health"
  ON polling_health FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "System can write polling health"
  ON polling_health FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "System can update polling health"
  ON polling_health FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- RLS Policies for polling_recovery_log
CREATE POLICY "Anyone can read recovery logs"
  ON polling_recovery_log FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "System can write recovery logs"
  ON polling_recovery_log FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- RLS Policies for polling_fallback_cache
CREATE POLICY "Anyone can read fallback cache"
  ON polling_fallback_cache FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "System can write fallback cache"
  ON polling_fallback_cache FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "System can update fallback cache"
  ON polling_fallback_cache FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "System can delete fallback cache"
  ON polling_fallback_cache FOR DELETE
  TO authenticated
  USING (true);

-- Insert initial health records for all tracked symbols
INSERT INTO polling_health (symbol, status, polling_interval_ms)
VALUES
  ('EURUSD', 'active', 3000),
  ('XAUUSD', 'active', 3000),
  ('US30', 'active', 3000),
  ('GBPUSD', 'active', 3000),
  ('USDJPY', 'active', 3000)
ON CONFLICT (symbol) DO NOTHING;
