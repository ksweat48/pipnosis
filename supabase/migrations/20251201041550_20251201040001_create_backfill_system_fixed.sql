/*
  # Historical Candle Backfill System

  1. New Tables
    - backfill_progress - Track backfill status per symbol/timeframe
    - backfill_sources - Track which data sources are available
    - backfill_execution_log - Log each backfill run
    - backfill_validation_stats - Track validation success/failure rates

  2. Security
    - Enable RLS on all tables
    - Service role can read/write
    - Authenticated users can read progress
*/

-- Backfill progress tracking
CREATE TABLE IF NOT EXISTS backfill_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  timeframe text NOT NULL,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  candles_fetched integer DEFAULT 0,
  candles_inserted integer DEFAULT 0,
  candles_rejected integer DEFAULT 0,
  status text DEFAULT 'pending',
  data_source text,
  error_message text,
  last_candle_time timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(symbol, timeframe, start_time)
);

CREATE INDEX IF NOT EXISTS idx_backfill_progress_symbol_timeframe ON backfill_progress(symbol, timeframe);
CREATE INDEX IF NOT EXISTS idx_backfill_progress_status ON backfill_progress(status);

-- Backfill data sources configuration
CREATE TABLE IF NOT EXISTS backfill_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name text UNIQUE NOT NULL,
  is_active boolean DEFAULT true,
  priority integer DEFAULT 0,
  rate_limit_per_minute integer DEFAULT 5,
  supports_symbols text[] DEFAULT '{}',
  supports_timeframes text[] DEFAULT '{}',
  last_used_at timestamptz,
  error_count integer DEFAULT 0,
  success_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

INSERT INTO backfill_sources (source_name, priority, rate_limit_per_minute, supports_symbols, supports_timeframes)
VALUES
  ('twelve_data', 100, 8, ARRAY['EURUSD','GBPUSD','USDJPY','XAUUSD','US30','BTCUSD','ETHUSD'], ARRAY['1min','5min','15min','30min','1h','4h','1day','1week']),
  ('fcsapi', 80, 10, ARRAY['EURUSD','GBPUSD','USDJPY','XAUUSD','US30'], ARRAY['1m','5m','15m','30m','1h','4h','1d','1w']),
  ('polygon', 70, 5, ARRAY['EURUSD','GBPUSD','USDJPY'], ARRAY['1','5','15','30','60','240','D','W'])
ON CONFLICT (source_name) DO NOTHING;

-- Backfill execution log
CREATE TABLE IF NOT EXISTS backfill_execution_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid NOT NULL,
  symbol text NOT NULL,
  timeframe text NOT NULL,
  batch_number integer,
  candles_count integer,
  source_used text,
  duration_ms integer,
  success boolean DEFAULT true,
  error_message text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_backfill_execution_log_execution_id ON backfill_execution_log(execution_id);
CREATE INDEX IF NOT EXISTS idx_backfill_execution_log_symbol ON backfill_execution_log(symbol, timeframe);

-- Backfill validation statistics
CREATE TABLE IF NOT EXISTS backfill_validation_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  timeframe text NOT NULL,
  date date DEFAULT CURRENT_DATE,
  total_candles integer DEFAULT 0,
  valid_candles integer DEFAULT 0,
  invalid_range integer DEFAULT 0,
  invalid_structure integer DEFAULT 0,
  invalid_velocity integer DEFAULT 0,
  contamination_detected integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(symbol, timeframe, date)
);

CREATE INDEX IF NOT EXISTS idx_backfill_validation_stats_symbol ON backfill_validation_stats(symbol, timeframe);

-- Enable RLS
ALTER TABLE backfill_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE backfill_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE backfill_execution_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE backfill_validation_stats ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Service role full access to backfill_progress" ON backfill_progress;
DROP POLICY IF EXISTS "Authenticated users can read backfill_progress" ON backfill_progress;
DROP POLICY IF EXISTS "Service role full access to backfill_sources" ON backfill_sources;
DROP POLICY IF EXISTS "Authenticated users can read backfill_sources" ON backfill_sources;
DROP POLICY IF EXISTS "Service role full access to backfill_execution_log" ON backfill_execution_log;
DROP POLICY IF EXISTS "Authenticated users can read backfill_execution_log" ON backfill_execution_log;
DROP POLICY IF EXISTS "Service role full access to backfill_validation_stats" ON backfill_validation_stats;
DROP POLICY IF EXISTS "Authenticated users can read backfill_validation_stats" ON backfill_validation_stats;

-- RLS Policies
CREATE POLICY "Service role full access to backfill_progress" ON backfill_progress FOR ALL USING (true);
CREATE POLICY "Authenticated users can read backfill_progress" ON backfill_progress FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role full access to backfill_sources" ON backfill_sources FOR ALL USING (true);
CREATE POLICY "Authenticated users can read backfill_sources" ON backfill_sources FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role full access to backfill_execution_log" ON backfill_execution_log FOR ALL USING (true);
CREATE POLICY "Authenticated users can read backfill_execution_log" ON backfill_execution_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role full access to backfill_validation_stats" ON backfill_validation_stats FOR ALL USING (true);
CREATE POLICY "Authenticated users can read backfill_validation_stats" ON backfill_validation_stats FOR SELECT TO authenticated USING (true);

-- Function: Mark backfill as complete
CREATE OR REPLACE FUNCTION mark_backfill_complete(
  p_symbol text,
  p_timeframe text,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_candles_inserted integer
)
RETURNS void AS $$
BEGIN
  INSERT INTO backfill_progress (symbol, timeframe, start_time, end_time, candles_inserted, status, last_candle_time, updated_at)
  VALUES (p_symbol, p_timeframe, p_start_time, p_end_time, p_candles_inserted, 'completed', p_end_time, now())
  ON CONFLICT (symbol, timeframe, start_time)
  DO UPDATE SET candles_inserted = p_candles_inserted, status = 'completed', last_candle_time = p_end_time, updated_at = now();
END;
$$ LANGUAGE plpgsql;