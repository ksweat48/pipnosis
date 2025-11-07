/*
  # Setup Server-Side Candle Aggregation System

  1. Purpose
    - Enable automatic candle aggregation that runs without browser
    - Create database triggers to aggregate candles in real-time
    - Set up scheduled jobs to ensure candle completeness

  2. Changes
    - Create candle_state table to track in-progress candles
    - Create trigger on realtime_prices to update candle state
    - Schedule finalization jobs to complete candles
    - Add monitoring views

  3. Security
    - All tables have appropriate RLS policies
    - Service role has necessary permissions
*/

-- Create table to track in-progress candle states
CREATE TABLE IF NOT EXISTS candle_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  timeframe text NOT NULL,
  open_time timestamptz NOT NULL,
  close_time timestamptz NOT NULL,
  open numeric NOT NULL,
  high numeric NOT NULL,
  low numeric NOT NULL,
  close numeric NOT NULL,
  volume integer DEFAULT 0,
  tick_count integer DEFAULT 0,
  last_updated timestamptz DEFAULT now(),
  is_complete boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE(symbol, timeframe, open_time)
);

-- Add indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_candle_state_symbol_timeframe 
  ON candle_state(symbol, timeframe);

CREATE INDEX IF NOT EXISTS idx_candle_state_incomplete 
  ON candle_state(symbol, timeframe, is_complete) 
  WHERE is_complete = false;

CREATE INDEX IF NOT EXISTS idx_candle_state_open_time 
  ON candle_state(open_time DESC);

-- Enable RLS
ALTER TABLE candle_state ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DO $$ 
BEGIN
  DROP POLICY IF EXISTS "Authenticated users can read candle state" ON candle_state;
  DROP POLICY IF EXISTS "Service role can modify candle state" ON candle_state;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Allow authenticated users to read candle state
CREATE POLICY "Authenticated users can read candle state"
  ON candle_state
  FOR SELECT
  TO authenticated
  USING (true);

-- Only service role can modify candle state
CREATE POLICY "Service role can modify candle state"
  ON candle_state
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Function to get candle boundary times for a given timestamp and timeframe
CREATE OR REPLACE FUNCTION get_candle_times(
  tick_time timestamptz,
  timeframe_minutes integer
)
RETURNS TABLE(open_time timestamptz, close_time timestamptz)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  interval_ms bigint;
  tick_ms bigint;
  candle_start_ms bigint;
BEGIN
  interval_ms := timeframe_minutes * 60 * 1000;
  tick_ms := EXTRACT(EPOCH FROM tick_time) * 1000;
  candle_start_ms := FLOOR(tick_ms / interval_ms) * interval_ms;
  
  open_time := to_timestamp(candle_start_ms / 1000.0);
  close_time := to_timestamp((candle_start_ms + interval_ms) / 1000.0);
  
  RETURN NEXT;
END;
$$;

-- Function to update candle state when new price arrives
CREATE OR REPLACE FUNCTION update_candle_state_on_price()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  timeframe_rec RECORD;
  candle_times RECORD;
  mid_price numeric;
  existing_candle RECORD;
  tick_time timestamptz;
BEGIN
  -- Calculate mid price
  mid_price := (NEW.bid + NEW.ask) / 2.0;
  
  -- Use broker_time if available, otherwise created_at
  tick_time := COALESCE(NEW.broker_time, NEW.created_at);
  
  -- Process each timeframe
  FOR timeframe_rec IN 
    SELECT 'M1' as tf, 1 as minutes UNION ALL
    SELECT 'M5', 5 UNION ALL
    SELECT 'M15', 15 UNION ALL
    SELECT 'M30', 30 UNION ALL
    SELECT 'H1', 60 UNION ALL
    SELECT 'H4', 240 UNION ALL
    SELECT 'D1', 1440 UNION ALL
    SELECT 'W1', 10080
  LOOP
    -- Get candle boundary times
    SELECT * INTO candle_times 
    FROM get_candle_times(tick_time, timeframe_rec.minutes);
    
    -- Check if candle already exists in candle_state
    SELECT * INTO existing_candle
    FROM candle_state
    WHERE symbol = NEW.symbol
      AND timeframe = timeframe_rec.tf
      AND open_time = candle_times.open_time
    FOR UPDATE;
    
    IF FOUND THEN
      -- Update existing candle
      UPDATE candle_state
      SET 
        high = GREATEST(high, mid_price),
        low = LEAST(low, mid_price),
        close = mid_price,
        tick_count = tick_count + 1,
        volume = volume + 1,
        last_updated = now()
      WHERE id = existing_candle.id;
    ELSE
      -- Create new candle
      INSERT INTO candle_state (
        symbol, timeframe, open_time, close_time,
        open, high, low, close, tick_count, volume
      ) VALUES (
        NEW.symbol, timeframe_rec.tf, candle_times.open_time, candle_times.close_time,
        mid_price, mid_price, mid_price, mid_price, 1, 1
      );
    END IF;
  END LOOP;
  
  RETURN NEW;
END;
$$;

-- Create trigger on realtime_prices
DROP TRIGGER IF EXISTS trigger_update_candle_state ON realtime_prices;

CREATE TRIGGER trigger_update_candle_state
  AFTER INSERT ON realtime_prices
  FOR EACH ROW
  EXECUTE FUNCTION update_candle_state_on_price();

-- Function to finalize completed candles
CREATE OR REPLACE FUNCTION finalize_completed_candles()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  completed_count integer := 0;
  candle_rec RECORD;
BEGIN
  -- Find candles that are complete (close_time has passed)
  FOR candle_rec IN
    SELECT * FROM candle_state
    WHERE is_complete = false
      AND close_time <= now()
    ORDER BY open_time
    LIMIT 1000  -- Process in batches
  LOOP
    -- Insert into forex_candles
    INSERT INTO forex_candles (
      symbol, timeframe, open_time, close_time,
      open, high, low, close, volume, tick_count
    ) VALUES (
      candle_rec.symbol, candle_rec.timeframe, 
      candle_rec.open_time, candle_rec.close_time,
      candle_rec.open, candle_rec.high, candle_rec.low, candle_rec.close,
      candle_rec.volume, candle_rec.tick_count
    )
    ON CONFLICT (symbol, timeframe, open_time) 
    DO UPDATE SET
      high = GREATEST(forex_candles.high, EXCLUDED.high),
      low = LEAST(forex_candles.low, EXCLUDED.low),
      close = EXCLUDED.close,
      volume = EXCLUDED.volume,
      tick_count = EXCLUDED.tick_count;
    
    -- Mark as complete
    UPDATE candle_state
    SET is_complete = true
    WHERE id = candle_rec.id;
    
    completed_count := completed_count + 1;
  END LOOP;
  
  -- Clean up completed candles older than 1 hour
  DELETE FROM candle_state
  WHERE is_complete = true
    AND close_time < now() - interval '1 hour';
  
  RETURN completed_count;
END;
$$;

-- Schedule candle finalization every minute
DO $$
BEGIN
  PERFORM cron.schedule(
    'finalize-candles-v2',
    '* * * * *',
    'SELECT finalize_completed_candles();'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Cron job already exists or could not be created: %', SQLERRM;
END $$;

-- Create monitoring view
CREATE OR REPLACE VIEW v_candle_aggregation_status AS
SELECT 
  symbol,
  timeframe,
  COUNT(*) as active_candles,
  MAX(last_updated) as last_update,
  EXTRACT(EPOCH FROM (now() - MAX(last_updated))) as seconds_since_last_update,
  SUM(tick_count) as total_ticks
FROM candle_state
WHERE is_complete = false
GROUP BY symbol, timeframe
ORDER BY symbol, timeframe;

GRANT SELECT ON v_candle_aggregation_status TO authenticated;

-- Create view for recent aggregation health
CREATE OR REPLACE VIEW v_recent_candle_health AS
SELECT 
  date_trunc('minute', executed_at) as minute,
  status,
  AVG(candles_created) as avg_candles_created,
  AVG(ticks_processed) as avg_ticks_processed,
  AVG(duration_ms) as avg_duration_ms,
  COUNT(*) as execution_count
FROM candle_aggregation_log
WHERE executed_at > now() - interval '1 hour'
GROUP BY date_trunc('minute', executed_at), status
ORDER BY minute DESC;

GRANT SELECT ON v_recent_candle_health TO authenticated;
