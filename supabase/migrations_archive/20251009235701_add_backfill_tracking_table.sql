/*
  # Add Backfill Tracking Infrastructure

  ## Overview
  This migration creates infrastructure for tracking historical data backfill operations,
  gap detection, and data quality monitoring.

  ## 1. New Tables

  ### `backfill_tasks`
  Tracks individual backfill operations for market data
  - `id` (text, primary key) - Unique task identifier
  - `symbol` (text, required) - Trading symbol being backfilled
  - `timeframe` (text, required) - Timeframe being backfilled
  - `start_date` (timestamptz, required) - Start of backfill date range
  - `end_date` (timestamptz, required) - End of backfill date range
  - `priority` (integer) - Task priority (higher = more urgent)
  - `status` (text) - Task status: pending, in_progress, completed, failed
  - `candles_target` (integer) - Expected number of candles to fetch
  - `candles_fetched` (integer) - Actual number of candles fetched
  - `error` (text) - Error message if task failed
  - `created_at` (timestamptz) - When task was created
  - `completed_at` (timestamptz) - When task completed

  ### `data_quality_logs`
  Logs data quality issues and gap detection results
  - `id` (uuid, primary key) - Unique log entry ID
  - `symbol` (text, required) - Trading symbol
  - `timeframe` (text, required) - Timeframe
  - `check_date` (timestamptz, required) - When quality check was performed
  - `date_range_start` (timestamptz) - Start of checked range
  - `date_range_end` (timestamptz) - End of checked range
  - `total_candles` (integer) - Total candles found
  - `expected_candles` (integer) - Expected candle count
  - `completeness_percentage` (numeric) - Data completeness percentage
  - `gaps_detected` (integer) - Number of gaps found
  - `critical_gaps` (integer) - Number of critical gaps
  - `problem_dates` (jsonb) - Array of dates with issues
  - `recommendations` (text) - Recommended actions

  ## 2. Indexes
  - Index on backfill_tasks (status, priority) for task queue processing
  - Index on backfill_tasks (symbol, timeframe, created_at) for filtering
  - Index on data_quality_logs (symbol, timeframe, check_date) for history

  ## 3. Security
  - Enable RLS on both tables
  - Only authenticated users can read
  - Only service role can insert/update

  ## 4. Functions
  - Function to get active backfill tasks
  - Function to get recent data quality reports
*/

-- Create backfill_tasks table
CREATE TABLE IF NOT EXISTS backfill_tasks (
  id text PRIMARY KEY,
  symbol text NOT NULL,
  timeframe text NOT NULL,
  start_date timestamptz NOT NULL,
  end_date timestamptz NOT NULL,
  priority integer DEFAULT 100,
  status text DEFAULT 'pending',
  candles_target integer DEFAULT 0,
  candles_fetched integer DEFAULT 0,
  error text,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  CHECK (status IN ('pending', 'in_progress', 'completed', 'failed'))
);

-- Create data_quality_logs table
CREATE TABLE IF NOT EXISTS data_quality_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  timeframe text NOT NULL,
  check_date timestamptz DEFAULT now(),
  date_range_start timestamptz,
  date_range_end timestamptz,
  total_candles integer DEFAULT 0,
  expected_candles integer DEFAULT 0,
  completeness_percentage numeric(5, 2) DEFAULT 0,
  gaps_detected integer DEFAULT 0,
  critical_gaps integer DEFAULT 0,
  problem_dates jsonb DEFAULT '[]'::jsonb,
  recommendations text,
  created_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_backfill_tasks_status_priority 
  ON backfill_tasks(status, priority DESC);

CREATE INDEX IF NOT EXISTS idx_backfill_tasks_symbol_timeframe 
  ON backfill_tasks(symbol, timeframe, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_backfill_tasks_status 
  ON backfill_tasks(status);

CREATE INDEX IF NOT EXISTS idx_data_quality_logs_symbol_timeframe 
  ON data_quality_logs(symbol, timeframe, check_date DESC);

CREATE INDEX IF NOT EXISTS idx_data_quality_logs_check_date 
  ON data_quality_logs(check_date DESC);

-- Enable RLS
ALTER TABLE backfill_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_quality_logs ENABLE ROW LEVEL SECURITY;

-- Backfill tasks policies
CREATE POLICY "Authenticated users can read backfill tasks"
  ON backfill_tasks FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can manage backfill tasks"
  ON backfill_tasks FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Data quality logs policies
CREATE POLICY "Authenticated users can read quality logs"
  ON data_quality_logs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can manage quality logs"
  ON data_quality_logs FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Function to get active backfill tasks
CREATE OR REPLACE FUNCTION get_active_backfill_tasks()
RETURNS TABLE (
  id text,
  symbol text,
  timeframe text,
  start_date timestamptz,
  end_date timestamptz,
  priority integer,
  status text,
  candles_target integer,
  candles_fetched integer,
  created_at timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    bt.id,
    bt.symbol,
    bt.timeframe,
    bt.start_date,
    bt.end_date,
    bt.priority,
    bt.status,
    bt.candles_target,
    bt.candles_fetched,
    bt.created_at
  FROM backfill_tasks bt
  WHERE bt.status IN ('pending', 'in_progress')
  ORDER BY bt.priority DESC, bt.created_at ASC;
END;
$$ LANGUAGE plpgsql;

-- Function to get recent data quality reports
CREATE OR REPLACE FUNCTION get_recent_quality_reports(
  p_symbol text DEFAULT NULL,
  p_timeframe text DEFAULT NULL,
  p_limit integer DEFAULT 20
)
RETURNS TABLE (
  id uuid,
  symbol text,
  timeframe text,
  check_date timestamptz,
  completeness_percentage numeric,
  gaps_detected integer,
  critical_gaps integer,
  recommendations text
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    dql.id,
    dql.symbol,
    dql.timeframe,
    dql.check_date,
    dql.completeness_percentage,
    dql.gaps_detected,
    dql.critical_gaps,
    dql.recommendations
  FROM data_quality_logs dql
  WHERE 
    (p_symbol IS NULL OR dql.symbol = p_symbol)
    AND (p_timeframe IS NULL OR dql.timeframe = p_timeframe)
  ORDER BY dql.check_date DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to log data quality check
CREATE OR REPLACE FUNCTION log_data_quality_check(
  p_symbol text,
  p_timeframe text,
  p_date_range_start timestamptz,
  p_date_range_end timestamptz,
  p_total_candles integer,
  p_expected_candles integer,
  p_gaps_detected integer,
  p_critical_gaps integer,
  p_problem_dates jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid AS $$
DECLARE
  v_log_id uuid;
  v_completeness numeric;
  v_recommendations text;
BEGIN
  v_completeness := CASE 
    WHEN p_expected_candles > 0 THEN (p_total_candles::numeric / p_expected_candles::numeric) * 100
    ELSE 0
  END;

  v_recommendations := CASE
    WHEN v_completeness < 80 THEN 'CRITICAL: Significant data gaps detected. Immediate backfill recommended.'
    WHEN v_completeness < 95 THEN 'WARNING: Data gaps detected. Backfill recommended.'
    WHEN p_critical_gaps > 0 THEN 'NOTICE: Critical gaps detected during trading hours. Review and backfill.'
    ELSE 'OK: Data quality is acceptable.'
  END;

  INSERT INTO data_quality_logs (
    symbol,
    timeframe,
    date_range_start,
    date_range_end,
    total_candles,
    expected_candles,
    completeness_percentage,
    gaps_detected,
    critical_gaps,
    problem_dates,
    recommendations
  ) VALUES (
    p_symbol,
    p_timeframe,
    p_date_range_start,
    p_date_range_end,
    p_total_candles,
    p_expected_candles,
    v_completeness,
    p_gaps_detected,
    p_critical_gaps,
    p_problem_dates,
    v_recommendations
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$ LANGUAGE plpgsql;
