/*
  # Add Data Completeness Monitoring

  1. New Tables
    - `data_completeness_status`
      - Tracks data health for each symbol/timeframe combination
      - Records oldest and newest candle timestamps
      - Monitors total candle count and last update time
      - Flags for data gaps and staleness

    - `data_refresh_log`
      - Logs all historical data refresh operations
      - Tracks success/failure status
      - Records fetch and save metrics
      - Useful for debugging and monitoring

  2. Security
    - Enable RLS on both tables
    - Authenticated users can read status
    - Only service role can write (via automated processes)

  3. Indexes
    - Fast lookups by symbol and timeframe
    - Ordered by last_updated for monitoring dashboards
*/

-- Data completeness status table
CREATE TABLE IF NOT EXISTS data_completeness_status (
  id bigserial PRIMARY KEY,
  symbol text NOT NULL,
  timeframe text NOT NULL,
  has_data boolean DEFAULT false,
  oldest_candle timestamptz,
  newest_candle timestamptz,
  total_candles integer DEFAULT 0,
  has_gaps boolean DEFAULT false,
  is_stale boolean DEFAULT false,
  last_updated timestamptz NOT NULL DEFAULT now(),
  last_refresh_attempt timestamptz,
  last_refresh_success timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(symbol, timeframe)
);

CREATE INDEX IF NOT EXISTS idx_data_completeness_symbol_timeframe
  ON data_completeness_status(symbol, timeframe);

CREATE INDEX IF NOT EXISTS idx_data_completeness_last_updated
  ON data_completeness_status(last_updated DESC);

CREATE INDEX IF NOT EXISTS idx_data_completeness_stale
  ON data_completeness_status(is_stale) WHERE is_stale = true;

-- Data refresh log table
CREATE TABLE IF NOT EXISTS data_refresh_log (
  id bigserial PRIMARY KEY,
  symbol text NOT NULL,
  timeframe text NOT NULL,
  refresh_type text NOT NULL,
  status text NOT NULL,
  candles_fetched integer DEFAULT 0,
  candles_saved integer DEFAULT 0,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_data_refresh_log_symbol_timeframe
  ON data_refresh_log(symbol, timeframe, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_data_refresh_log_status
  ON data_refresh_log(status, created_at DESC);

-- Enable RLS
ALTER TABLE data_completeness_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_refresh_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies - Read access for authenticated users
CREATE POLICY "Authenticated users can read completeness status"
  ON data_completeness_status
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can read refresh log"
  ON data_refresh_log
  FOR SELECT
  TO authenticated
  USING (true);

-- Service role full access
CREATE POLICY "Service role full access to completeness status"
  ON data_completeness_status
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role full access to refresh log"
  ON data_refresh_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Function to update data completeness status
CREATE OR REPLACE FUNCTION update_data_completeness_status(
  p_symbol text,
  p_timeframe text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_has_data boolean;
  v_oldest timestamptz;
  v_newest timestamptz;
  v_total integer;
BEGIN
  -- Get statistics from forex_candles
  SELECT
    COUNT(*) > 0,
    MIN(open_time),
    MAX(open_time),
    COUNT(*)
  INTO
    v_has_data,
    v_oldest,
    v_newest,
    v_total
  FROM forex_candles
  WHERE symbol = p_symbol
    AND timeframe = p_timeframe;

  -- Upsert the status
  INSERT INTO data_completeness_status (
    symbol,
    timeframe,
    has_data,
    oldest_candle,
    newest_candle,
    total_candles,
    last_updated
  )
  VALUES (
    p_symbol,
    p_timeframe,
    v_has_data,
    v_oldest,
    v_newest,
    v_total,
    now()
  )
  ON CONFLICT (symbol, timeframe)
  DO UPDATE SET
    has_data = v_has_data,
    oldest_candle = v_oldest,
    newest_candle = v_newest,
    total_candles = v_total,
    last_updated = now();
END;
$$;

-- Function to check if data is stale (no updates in 1 hour)
CREATE OR REPLACE FUNCTION mark_stale_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE data_completeness_status
  SET is_stale = true
  WHERE newest_candle < now() - interval '1 hour'
    AND has_data = true;

  UPDATE data_completeness_status
  SET is_stale = false
  WHERE newest_candle >= now() - interval '1 hour';
END;
$$;