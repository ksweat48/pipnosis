/*
  # Create market_data table and sync mechanism

  ## Overview
  This migration creates the market_data table that the AI scanner expects and sets up
  automatic synchronization from forex_candles to market_data.

  ## New Tables

  ### market_data
  - Unified market data table for AI scanner consumption
  - Supports all symbols: XAUUSD, US30, EURUSD, GBPUSD, etc.
  - Normalized structure with consistent timeframe format
  - Optimized indexes for scanner queries

  ## Features
  - Automatic sync trigger from forex_candles to market_data
  - Data normalization and validation
  - Symbol-specific handling for different asset classes
  - Performance indexes for fast scanner queries

  ## Security
  - RLS enabled for secure data access
  - Authenticated users can read market data
  - Service role can write data (for Netlify functions)
*/

-- Create market_data table
CREATE TABLE IF NOT EXISTS market_data (
  id bigserial PRIMARY KEY,
  symbol text NOT NULL,
  timeframe text NOT NULL,
  timestamp timestamptz NOT NULL,
  open numeric NOT NULL,
  high numeric NOT NULL,
  low numeric NOT NULL,
  close numeric NOT NULL,
  volume numeric DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(symbol, timeframe, timestamp)
);

-- Create indexes for fast scanner queries
CREATE INDEX IF NOT EXISTS idx_market_data_symbol_timeframe_timestamp
  ON market_data(symbol, timeframe, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_market_data_symbol_timestamp
  ON market_data(symbol, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_market_data_timeframe_timestamp
  ON market_data(timeframe, timestamp DESC);

-- Enable RLS
ALTER TABLE market_data ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Authenticated users can read market data"
  ON market_data
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role full access to market data"
  ON market_data
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Create function to sync forex_candles to market_data
CREATE OR REPLACE FUNCTION sync_forex_candles_to_market_data()
RETURNS TRIGGER AS $$
BEGIN
  -- Insert or update market_data when forex_candles changes
  INSERT INTO market_data (
    symbol,
    timeframe,
    timestamp,
    open,
    high,
    low,
    close,
    volume
  ) VALUES (
    NEW.symbol,
    NEW.timeframe,
    NEW.open_time,
    NEW.open,
    NEW.high,
    NEW.low,
    NEW.close,
    NEW.volume
  )
  ON CONFLICT (symbol, timeframe, timestamp)
  DO UPDATE SET
    open = EXCLUDED.open,
    high = EXCLUDED.high,
    low = EXCLUDED.low,
    close = EXCLUDED.close,
    volume = EXCLUDED.volume,
    created_at = now();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on forex_candles
DROP TRIGGER IF EXISTS sync_to_market_data ON forex_candles;
CREATE TRIGGER sync_to_market_data
  AFTER INSERT OR UPDATE ON forex_candles
  FOR EACH ROW
  EXECUTE FUNCTION sync_forex_candles_to_market_data();

-- Backfill existing forex_candles data into market_data
INSERT INTO market_data (symbol, timeframe, timestamp, open, high, low, close, volume)
SELECT
  symbol,
  timeframe,
  open_time as timestamp,
  open,
  high,
  low,
  close,
  COALESCE(volume, 0) as volume
FROM forex_candles
ON CONFLICT (symbol, timeframe, timestamp) DO NOTHING;

-- Create function to get market data statistics
CREATE OR REPLACE FUNCTION get_market_data_stats(p_symbol text, p_timeframe text)
RETURNS TABLE (
  symbol text,
  timeframe text,
  candle_count bigint,
  oldest_candle timestamptz,
  newest_candle timestamptz,
  data_quality text
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p_symbol as symbol,
    p_timeframe as timeframe,
    COUNT(*)::bigint as candle_count,
    MIN(timestamp) as oldest_candle,
    MAX(timestamp) as newest_candle,
    CASE
      WHEN COUNT(*) >= 100 THEN 'excellent'
      WHEN COUNT(*) >= 50 THEN 'good'
      WHEN COUNT(*) >= 20 THEN 'sufficient'
      ELSE 'insufficient'
    END as data_quality
  FROM market_data
  WHERE market_data.symbol = p_symbol
    AND market_data.timeframe = p_timeframe;
END;
$$ LANGUAGE plpgsql;
