/*
  # Create Historical Candles Table
  
  ## Overview
  This migration creates a dedicated table for storing historical candle data
  fetched from MetaApi for AI analysis and trading simulation.
  
  ## Table Structure
  - `historical_candles` - Stores OHLC data for symbols and timeframes
  - Unique constraint on (symbol, timeframe, time) to prevent duplicates
  - Optimized indexes for fast querying by symbol, timeframe, and time range
*/

-- Create historical_candles table
CREATE TABLE IF NOT EXISTS historical_candles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  timeframe text NOT NULL,
  time timestamptz NOT NULL,
  open numeric(20, 8) NOT NULL,
  high numeric(20, 8) NOT NULL,
  low numeric(20, 8) NOT NULL,
  close numeric(20, 8) NOT NULL,
  volume numeric(20, 8) DEFAULT 0,
  tick_volume integer DEFAULT 0,
  spread integer DEFAULT 0,
  broker_time text,
  data_source text DEFAULT 'metaapi_historical',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(symbol, timeframe, time)
);

-- Create indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_historical_candles_symbol_timeframe_time 
  ON historical_candles(symbol, timeframe, time DESC);

CREATE INDEX IF NOT EXISTS idx_historical_candles_symbol 
  ON historical_candles(symbol);

CREATE INDEX IF NOT EXISTS idx_historical_candles_timeframe 
  ON historical_candles(timeframe);

CREATE INDEX IF NOT EXISTS idx_historical_candles_time 
  ON historical_candles(time DESC);

CREATE INDEX IF NOT EXISTS idx_historical_candles_data_source 
  ON historical_candles(data_source);

-- Enable RLS
ALTER TABLE historical_candles ENABLE ROW LEVEL SECURITY;

-- Anyone can read historical candles (market data is public)
CREATE POLICY "Anyone can read historical candles"
  ON historical_candles FOR SELECT
  TO anon, authenticated
  USING (true);

-- Only authenticated users can insert/update
CREATE POLICY "Authenticated users can insert historical candles"
  ON historical_candles FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update historical candles"
  ON historical_candles FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_historical_candles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for updated_at
DROP TRIGGER IF EXISTS historical_candles_updated_at ON historical_candles;
CREATE TRIGGER historical_candles_updated_at
  BEFORE UPDATE ON historical_candles
  FOR EACH ROW
  EXECUTE FUNCTION update_historical_candles_updated_at();

-- Function to get candle count statistics
CREATE OR REPLACE FUNCTION get_historical_candle_stats(
  p_symbol text,
  p_timeframe text
)
RETURNS TABLE (
  symbol text,
  timeframe text,
  total_candles bigint,
  oldest_candle timestamptz,
  newest_candle timestamptz,
  date_range_days numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    hc.symbol,
    hc.timeframe,
    COUNT(*)::bigint as total_candles,
    MIN(hc.time) as oldest_candle,
    MAX(hc.time) as newest_candle,
    EXTRACT(EPOCH FROM (MAX(hc.time) - MIN(hc.time))) / 86400 as date_range_days
  FROM historical_candles hc
  WHERE 
    hc.symbol = p_symbol
    AND hc.timeframe = p_timeframe
  GROUP BY hc.symbol, hc.timeframe;
END;
$$ LANGUAGE plpgsql;

-- Function to check for existing candles in date range
CREATE OR REPLACE FUNCTION check_historical_candles_exist(
  p_symbol text,
  p_timeframe text,
  p_start_time timestamptz,
  p_end_time timestamptz
)
RETURNS TABLE (
  exists boolean,
  candle_count bigint
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*) > 0 as exists,
    COUNT(*)::bigint as candle_count
  FROM historical_candles hc
  WHERE 
    hc.symbol = p_symbol
    AND hc.timeframe = p_timeframe
    AND hc.time >= p_start_time
    AND hc.time <= p_end_time;
END;
$$ LANGUAGE plpgsql;
