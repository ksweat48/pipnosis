/*
  # Refresh Schedules and History Tracking

  1. New Tables
    - `refresh_schedules`
      - `id` (uuid, primary key)
      - `symbol` (text, trading symbol like EURUSD)
      - `timeframe` (text, one of: 5m, 15m, 1h)
      - `days_back` (integer, number of days to refresh)
      - `enabled` (boolean, whether schedule is active)
      - `last_run_at` (timestamptz, when last refresh occurred)
      - `next_run_at` (timestamptz, when next refresh is scheduled)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    
    - `refresh_history`
      - `id` (uuid, primary key)
      - `schedule_id` (uuid, foreign key to refresh_schedules, nullable for manual runs)
      - `symbol` (text)
      - `timeframe` (text)
      - `started_at` (timestamptz)
      - `completed_at` (timestamptz, nullable)
      - `candles_fetched` (integer)
      - `candles_saved` (integer)
      - `status` (text, one of: running, completed, failed)
      - `error_message` (text, nullable)
      - `duration_ms` (integer, nullable)
      - `triggered_by` (text, one of: manual, scheduled, batch)

  2. Security
    - Enable RLS on both tables
    - Only authenticated users can read schedules and history
    - Only admins can create, update, or delete schedules
    
  3. Indexes
    - Index on refresh_schedules(symbol, timeframe) for lookups
    - Index on refresh_schedules(enabled, next_run_at) for scheduler
    - Index on refresh_history(started_at) for time-based queries
    - Index on refresh_history(status) for filtering
    
  4. Functions
    - Function to get active schedules
    - Function to update schedule after run
    - Function to get refresh history with filtering
*/

-- Create refresh_schedules table
CREATE TABLE IF NOT EXISTS refresh_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  timeframe text NOT NULL CHECK (timeframe IN ('5m', '15m', '1h')),
  days_back integer NOT NULL DEFAULT 3 CHECK (days_back >= 1 AND days_back <= 365),
  enabled boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(symbol, timeframe)
);

-- Create refresh_history table
CREATE TABLE IF NOT EXISTS refresh_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid REFERENCES refresh_schedules(id) ON DELETE SET NULL,
  symbol text NOT NULL,
  timeframe text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  candles_fetched integer DEFAULT 0,
  candles_saved integer DEFAULT 0,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  error_message text,
  duration_ms integer,
  triggered_by text NOT NULL DEFAULT 'manual' CHECK (triggered_by IN ('manual', 'scheduled', 'batch'))
);

-- Enable RLS
ALTER TABLE refresh_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies for refresh_schedules (using is_admin column)
CREATE POLICY "Authenticated users can read refresh schedules"
  ON refresh_schedules FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert refresh schedules"
  ON refresh_schedules FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can update refresh schedules"
  ON refresh_schedules FOR UPDATE
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

CREATE POLICY "Admins can delete refresh schedules"
  ON refresh_schedules FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- RLS Policies for refresh_history
CREATE POLICY "Authenticated users can read refresh history"
  ON refresh_history FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can insert refresh history"
  ON refresh_history FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update refresh history"
  ON refresh_history FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_refresh_schedules_symbol_timeframe 
  ON refresh_schedules(symbol, timeframe);

CREATE INDEX IF NOT EXISTS idx_refresh_schedules_enabled_next_run 
  ON refresh_schedules(enabled, next_run_at) WHERE enabled = true;

CREATE INDEX IF NOT EXISTS idx_refresh_history_started_at 
  ON refresh_history(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_refresh_history_status 
  ON refresh_history(status);

CREATE INDEX IF NOT EXISTS idx_refresh_history_symbol_timeframe 
  ON refresh_history(symbol, timeframe);

-- Function to get active schedules due for refresh
CREATE OR REPLACE FUNCTION get_active_refresh_schedules()
RETURNS TABLE (
  id uuid,
  symbol text,
  timeframe text,
  days_back integer,
  last_run_at timestamptz
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    rs.id,
    rs.symbol,
    rs.timeframe,
    rs.days_back,
    rs.last_run_at
  FROM refresh_schedules rs
  WHERE rs.enabled = true
    AND (rs.next_run_at IS NULL OR rs.next_run_at <= now())
  ORDER BY rs.last_run_at NULLS FIRST;
END;
$$;

-- Function to update schedule after run
CREATE OR REPLACE FUNCTION update_schedule_after_run(
  p_schedule_id uuid,
  p_next_run_interval interval DEFAULT '1 day'::interval
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE refresh_schedules
  SET 
    last_run_at = now(),
    next_run_at = now() + p_next_run_interval,
    updated_at = now()
  WHERE id = p_schedule_id;
END;
$$;

-- Function to get refresh history with filtering
CREATE OR REPLACE FUNCTION get_refresh_history(
  p_symbol text DEFAULT NULL,
  p_timeframe text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  id uuid,
  schedule_id uuid,
  symbol text,
  timeframe text,
  started_at timestamptz,
  completed_at timestamptz,
  candles_fetched integer,
  candles_saved integer,
  status text,
  error_message text,
  duration_ms integer,
  triggered_by text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    rh.id,
    rh.schedule_id,
    rh.symbol,
    rh.timeframe,
    rh.started_at,
    rh.completed_at,
    rh.candles_fetched,
    rh.candles_saved,
    rh.status,
    rh.error_message,
    rh.duration_ms,
    rh.triggered_by
  FROM refresh_history rh
  WHERE 
    (p_symbol IS NULL OR rh.symbol = p_symbol)
    AND (p_timeframe IS NULL OR rh.timeframe = p_timeframe)
    AND (p_status IS NULL OR rh.status = p_status)
  ORDER BY rh.started_at DESC
  LIMIT p_limit;
END;
$$;

-- Function to create history entry
CREATE OR REPLACE FUNCTION create_refresh_history_entry(
  p_schedule_id uuid,
  p_symbol text,
  p_timeframe text,
  p_triggered_by text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_history_id uuid;
BEGIN
  INSERT INTO refresh_history (
    schedule_id,
    symbol,
    timeframe,
    triggered_by,
    status
  ) VALUES (
    p_schedule_id,
    p_symbol,
    p_timeframe,
    p_triggered_by,
    'running'
  )
  RETURNING id INTO v_history_id;
  
  RETURN v_history_id;
END;
$$;

-- Function to complete history entry
CREATE OR REPLACE FUNCTION complete_refresh_history_entry(
  p_history_id uuid,
  p_candles_fetched integer,
  p_candles_saved integer,
  p_status text,
  p_error_message text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE refresh_history
  SET 
    completed_at = now(),
    candles_fetched = p_candles_fetched,
    candles_saved = p_candles_saved,
    status = p_status,
    error_message = p_error_message,
    duration_ms = EXTRACT(EPOCH FROM (now() - started_at)) * 1000
  WHERE id = p_history_id;
END;
$$;

-- Insert default schedules for common pairs
INSERT INTO refresh_schedules (symbol, timeframe, days_back, enabled, next_run_at)
VALUES 
  ('EURUSD', '5m', 3, true, now()),
  ('EURUSD', '15m', 3, true, now()),
  ('EURUSD', '1h', 7, true, now()),
  ('GBPUSD', '5m', 3, true, now()),
  ('GBPUSD', '15m', 3, true, now()),
  ('GBPUSD', '1h', 7, true, now()),
  ('XAUUSD', '5m', 3, true, now()),
  ('XAUUSD', '15m', 3, true, now()),
  ('XAUUSD', '1h', 7, true, now())
ON CONFLICT (symbol, timeframe) DO NOTHING;
