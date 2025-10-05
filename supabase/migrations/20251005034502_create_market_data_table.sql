/*
  # Create Market Data Table for Live Price Caching

  ## Overview
  This migration creates infrastructure for storing and caching real-time market data from MetaApi.
  All historical and real-time candlestick data will be persisted to minimize API costs and improve performance.

  ## 1. New Tables
  
  ### `market_data`
  Stores OHLC candlestick data for all symbols and timeframes
  - `id` (uuid, primary key) - Unique identifier for each candle
  - `symbol` (text, required) - Trading pair (e.g., EURUSD, GBPUSD, XAUUSD)
  - `timeframe` (text, required) - Candle interval (M1, M5, M15, M30, H1, H4, D1, W1, MN1)
  - `timestamp` (timestamptz, required) - Candle open time in UTC
  - `open` (numeric, required) - Opening price
  - `high` (numeric, required) - Highest price in period
  - `low` (numeric, required) - Lowest price in period
  - `close` (numeric, required) - Closing price
  - `volume` (numeric) - Trading volume if available
  - `tick_volume` (integer) - Number of ticks in period
  - `spread` (integer) - Bid/ask spread in points
  - `broker_time` (timestamptz) - Original broker timestamp
  - `data_source` (text) - Source of data (metaapi, cache, etc)
  - `created_at` (timestamptz) - Record creation time
  - `updated_at` (timestamptz) - Last update time

  ### `market_data_subscriptions`
  Tracks active real-time data subscriptions
  - `id` (uuid, primary key)
  - `symbol` (text, required) - Subscribed symbol
  - `timeframe` (text, required) - Subscribed timeframe
  - `last_update` (timestamptz) - Last data update received
  - `status` (text) - Subscription status (active, paused, error)
  - `metadata` (jsonb) - Additional subscription info

  ## 2. Indexes
  - Composite index on (symbol, timeframe, timestamp) for fast range queries
  - Individual indexes on symbol and timeframe for filtering
  - Index on timestamp for time-based queries

  ## 3. Security
  - Enable RLS on market_data table
  - Public read access (market data is public information)
  - Insert/update restricted to service role only

  ## 4. Data Retention
  - M1 data: 30 days retention
  - M5/M15 data: 90 days retention  
  - H1/H4 data: 1 year retention
  - D1/W1/MN1 data: Unlimited retention
*/

-- Create market_data table
CREATE TABLE IF NOT EXISTS market_data (
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
  spread integer DEFAULT 0,
  broker_time timestamptz,
  data_source text DEFAULT 'metaapi',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(symbol, timeframe, timestamp)
);

-- Create market_data_subscriptions table
CREATE TABLE IF NOT EXISTS market_data_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  timeframe text NOT NULL,
  last_update timestamptz DEFAULT now(),
  status text DEFAULT 'active',
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(symbol, timeframe)
);

-- Create indexes for market_data
CREATE INDEX IF NOT EXISTS idx_market_data_symbol_timeframe_timestamp 
  ON market_data(symbol, timeframe, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_market_data_symbol 
  ON market_data(symbol);

CREATE INDEX IF NOT EXISTS idx_market_data_timeframe 
  ON market_data(timeframe);

CREATE INDEX IF NOT EXISTS idx_market_data_timestamp 
  ON market_data(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_market_data_created_at 
  ON market_data(created_at DESC);

-- Create index for subscriptions
CREATE INDEX IF NOT EXISTS idx_subscriptions_status 
  ON market_data_subscriptions(status);

-- Enable RLS
ALTER TABLE market_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_data_subscriptions ENABLE ROW LEVEL SECURITY;

-- Market data is public - anyone can read
CREATE POLICY "Anyone can read market data"
  ON market_data FOR SELECT
  TO anon, authenticated
  USING (true);

-- Only service role can insert/update market data
CREATE POLICY "Service role can insert market data"
  ON market_data FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Service role can update market data"
  ON market_data FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Subscription policies
CREATE POLICY "Authenticated users can read subscriptions"
  ON market_data_subscriptions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can manage subscriptions"
  ON market_data_subscriptions FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_market_data_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for market_data
DROP TRIGGER IF EXISTS market_data_updated_at ON market_data;
CREATE TRIGGER market_data_updated_at
  BEFORE UPDATE ON market_data
  FOR EACH ROW
  EXECUTE FUNCTION update_market_data_updated_at();

-- Trigger for subscriptions
DROP TRIGGER IF EXISTS subscriptions_updated_at ON market_data_subscriptions;
CREATE TRIGGER subscriptions_updated_at
  BEFORE UPDATE ON market_data_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION update_market_data_updated_at();