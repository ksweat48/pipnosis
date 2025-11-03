/*
  # Candle Aggregation System

  1. New Tables
    - `candle_aggregation_log` - Tracks execution of candle aggregation jobs
      - `id` (uuid, primary key)
      - `executed_at` (timestamptz) - When the job ran
      - `status` (text) - success or error
      - `ticks_processed` (integer) - Number of ticks aggregated
      - `candles_created` (integer) - Number of candles created
      - `symbols_processed` (integer) - Number of symbols processed
      - `duration_ms` (integer) - Job execution time
      - `message` (text) - Optional message
      - `error_message` (text) - Error details if failed
      - `details` (jsonb) - Detailed results per symbol/timeframe

  2. Indexes for Performance
    - Add composite index on realtime_prices for fast aggregation queries
    - Add index on forex_candles for efficient lookups
    - Add index on market_data for time-range queries
    - Add index on aggregation log for monitoring

  3. Database Functions
    - `cleanup_old_realtime_prices()` - Removes ticks older than 24 hours
    - `get_aggregation_stats()` - Returns job execution statistics

  4. Security
    - Enable RLS on candle_aggregation_log
    - Add policies for authenticated users to read logs
    - Only service role can write logs
*/

-- Create candle aggregation log table
CREATE TABLE IF NOT EXISTS candle_aggregation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  executed_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK (status IN ('success', 'error')),
  ticks_processed integer NOT NULL DEFAULT 0,
  candles_created integer NOT NULL DEFAULT 0,
  symbols_processed integer NOT NULL DEFAULT 0,
  duration_ms integer NOT NULL DEFAULT 0,
  message text,
  error_message text,
  details jsonb,
  created_at timestamptz DEFAULT now()
);

-- Add tick_count column to forex_candles if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'forex_candles' AND column_name = 'tick_count'
  ) THEN
    ALTER TABLE forex_candles ADD COLUMN tick_count integer DEFAULT 0;
  END IF;
END $$;

-- Performance indexes for realtime_prices
CREATE INDEX IF NOT EXISTS idx_realtime_prices_symbol_time
  ON realtime_prices(symbol, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_realtime_prices_broker_time
  ON realtime_prices(broker_time) WHERE broker_time IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_realtime_prices_created_at
  ON realtime_prices(created_at DESC);

-- Performance indexes for forex_candles
CREATE INDEX IF NOT EXISTS idx_forex_candles_symbol_timeframe_time
  ON forex_candles(symbol, timeframe, open_time DESC);

CREATE INDEX IF NOT EXISTS idx_forex_candles_close_time
  ON forex_candles(close_time DESC);

CREATE INDEX IF NOT EXISTS idx_forex_candles_tick_count
  ON forex_candles(tick_count) WHERE tick_count > 0;

-- Performance indexes for market_data
CREATE INDEX IF NOT EXISTS idx_market_data_symbol_timeframe_time
  ON market_data(symbol, timeframe, timestamp DESC);

-- Index for aggregation log monitoring
CREATE INDEX IF NOT EXISTS idx_aggregation_log_executed_at
  ON candle_aggregation_log(executed_at DESC);

CREATE INDEX IF NOT EXISTS idx_aggregation_log_status
  ON candle_aggregation_log(status, executed_at DESC);

-- Function to cleanup old realtime prices (older than 24 hours)
DROP FUNCTION IF EXISTS cleanup_old_realtime_prices();

CREATE OR REPLACE FUNCTION cleanup_old_realtime_prices()
RETURNS TABLE(deleted_count bigint, oldest_kept timestamptz, newest_kept timestamptz) AS $$
DECLARE
  cutoff_time timestamptz;
  rows_deleted bigint;
  oldest_remaining timestamptz;
  newest_remaining timestamptz;
BEGIN
  -- Calculate cutoff time (24 hours ago)
  cutoff_time := now() - interval '24 hours';

  -- Delete old records
  WITH deleted AS (
    DELETE FROM realtime_prices
    WHERE created_at < cutoff_time
    RETURNING *
  )
  SELECT count(*) INTO rows_deleted FROM deleted;

  -- Get remaining data range
  SELECT MIN(created_at), MAX(created_at)
  INTO oldest_remaining, newest_remaining
  FROM realtime_prices;

  -- Return results
  RETURN QUERY SELECT rows_deleted, oldest_remaining, newest_remaining;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get aggregation statistics
CREATE OR REPLACE FUNCTION get_aggregation_stats(hours_back integer DEFAULT 24)
RETURNS TABLE(
  total_runs bigint,
  successful_runs bigint,
  failed_runs bigint,
  total_ticks_processed bigint,
  total_candles_created bigint,
  avg_duration_ms numeric,
  last_run_time timestamptz,
  last_success_time timestamptz,
  last_error_message text
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::bigint as total_runs,
    COUNT(*) FILTER (WHERE status = 'success')::bigint as successful_runs,
    COUNT(*) FILTER (WHERE status = 'error')::bigint as failed_runs,
    SUM(ticks_processed)::bigint as total_ticks_processed,
    SUM(candles_created)::bigint as total_candles_created,
    AVG(duration_ms)::numeric as avg_duration_ms,
    MAX(executed_at) as last_run_time,
    MAX(executed_at) FILTER (WHERE status = 'success') as last_success_time,
    (
      SELECT error_message
      FROM candle_aggregation_log
      WHERE status = 'error'
      AND executed_at >= now() - (hours_back || ' hours')::interval
      ORDER BY executed_at DESC
      LIMIT 1
    ) as last_error_message
  FROM candle_aggregation_log
  WHERE executed_at >= now() - (hours_back || ' hours')::interval;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Enable RLS on candle_aggregation_log
ALTER TABLE candle_aggregation_log ENABLE ROW LEVEL SECURITY;

-- Policy: Authenticated users can read aggregation logs
CREATE POLICY "Authenticated users can view aggregation logs"
  ON candle_aggregation_log
  FOR SELECT
  TO authenticated
  USING (true);

-- Policy: Only service role can insert logs (via edge function)
CREATE POLICY "Service role can insert aggregation logs"
  ON candle_aggregation_log
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Create a view for easy monitoring
CREATE OR REPLACE VIEW aggregation_health AS
SELECT
  status,
  COUNT(*) as count,
  MAX(executed_at) as last_occurrence,
  AVG(duration_ms) as avg_duration_ms,
  SUM(ticks_processed) as total_ticks,
  SUM(candles_created) as total_candles
FROM candle_aggregation_log
WHERE executed_at >= now() - interval '24 hours'
GROUP BY status;

-- Grant access to the view
GRANT SELECT ON aggregation_health TO authenticated;

-- Add comment explaining the system
COMMENT ON TABLE candle_aggregation_log IS
  'Logs execution of the candle aggregation edge function that runs every 5 minutes to convert realtime_prices into OHLC candles';

COMMENT ON FUNCTION cleanup_old_realtime_prices() IS
  'Removes realtime_prices older than 24 hours. Run daily after verifying candles were created successfully.';

COMMENT ON FUNCTION get_aggregation_stats(integer) IS
  'Returns statistics about candle aggregation job performance over the specified number of hours.';
