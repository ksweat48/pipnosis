/*
  # Clean Slate - Minimal MetaAPI Schema
  
  Simple, minimal schema for MetaAPI forex data.
  
  ## New Tables
  
  ### forex_live_prices
  - Simple table for current live prices
  - Just the essentials: symbol, bid, ask, timestamp
  - No caching complexity, no token management
  
  ### forex_candles
  - Simple candle/OHLC data storage
  - Standard timeframes: M1, M5, M15, M30, H1, H4, D1
  - Clean, straightforward structure
  
  ## Security
  - RLS enabled on both tables
  - Authenticated users can read
  - Only service role can write (via Netlify functions)
*/

-- Live prices table (simple)
CREATE TABLE IF NOT EXISTS forex_live_prices (
  id bigserial PRIMARY KEY,
  symbol text NOT NULL,
  bid numeric NOT NULL,
  ask numeric NOT NULL,
  spread numeric GENERATED ALWAYS AS (ask - bid) STORED,
  timestamp timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_forex_live_prices_symbol_timestamp 
  ON forex_live_prices(symbol, timestamp DESC);

-- Candles table (simple)
CREATE TABLE IF NOT EXISTS forex_candles (
  id bigserial PRIMARY KEY,
  symbol text NOT NULL,
  timeframe text NOT NULL,
  open_time timestamptz NOT NULL,
  close_time timestamptz NOT NULL,
  open numeric NOT NULL,
  high numeric NOT NULL,
  low numeric NOT NULL,
  close numeric NOT NULL,
  volume numeric DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(symbol, timeframe, open_time)
);

-- Create indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_forex_candles_symbol_timeframe_time
  ON forex_candles(symbol, timeframe, open_time DESC);

-- Enable RLS
ALTER TABLE forex_live_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE forex_candles ENABLE ROW LEVEL SECURITY;

-- RLS Policies - Read access for authenticated users
CREATE POLICY "Authenticated users can read live prices"
  ON forex_live_prices
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can read candles"
  ON forex_candles
  FOR SELECT
  TO authenticated
  USING (true);

-- Service role can do everything (for Netlify functions)
CREATE POLICY "Service role full access to live prices"
  ON forex_live_prices
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role full access to candles"
  ON forex_candles
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
