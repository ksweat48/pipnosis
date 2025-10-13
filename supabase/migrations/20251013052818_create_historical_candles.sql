/*
  # Create Historical Candles Table

  1. New Tables
    - `historical_candles` - Stores historical OHLC candlestick data
      - Separate from real-time market_data for better organization
      - Optimized for historical analysis and backtesting
      - Includes metadata for data source tracking

  2. Security
    - Enable RLS on historical_candles table
    - Public read access (market data is public information)
    - Authenticated users can insert/update

  3. Indexes
    - Composite index on (symbol, timeframe, timestamp) for fast queries
    - Individual indexes for common query patterns
*/

-- Create historical_candles table
CREATE TABLE IF NOT EXISTS historical_candles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  timeframe text NOT NULL,
  timestamp timestamptz NOT NULL,
  open numeric(20, 8) NOT NULL,
  high numeric(20, 8) NOT NULL,
  low numeric(20, 8) NOT NULL,
  close numeric(20, 8) NOT NULL,
  volume numeric(20, 8) DEFAULT 0,
  tick_volume integer DEFAULT 0,
  data_source text DEFAULT 'metaapi',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(symbol, timeframe, timestamp)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_historical_candles_symbol_timeframe_timestamp
  ON historical_candles(symbol, timeframe, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_historical_candles_symbol
  ON historical_candles(symbol);

CREATE INDEX IF NOT EXISTS idx_historical_candles_timestamp
  ON historical_candles(timestamp DESC);

-- Enable RLS
ALTER TABLE historical_candles ENABLE ROW LEVEL SECURITY;

-- Anyone can read historical candles
CREATE POLICY "Anyone can read historical candles"
  ON historical_candles FOR SELECT
  TO anon, authenticated
  USING (true);

-- Authenticated users can insert historical candles
CREATE POLICY "Authenticated users can insert historical candles"
  ON historical_candles FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Authenticated users can update historical candles
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

-- Trigger for historical_candles
DROP TRIGGER IF EXISTS historical_candles_updated_at ON historical_candles;
CREATE TRIGGER historical_candles_updated_at
  BEFORE UPDATE ON historical_candles
  FOR EACH ROW
  EXECUTE FUNCTION update_historical_candles_updated_at();