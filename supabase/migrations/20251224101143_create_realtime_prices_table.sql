/*
  # Create Realtime Prices Table

  ## Summary
  Creates the missing realtime_prices table that is referenced throughout the codebase
  for live price tracking and stop loss monitoring.

  ## New Table
  - `realtime_prices` - Stores real-time price data from MetaAPI
    - `id` (uuid, primary key)
    - `symbol` (text) - Trading symbol (e.g., EURUSD, XAUUSD)
    - `bid` (decimal) - Bid price
    - `ask` (decimal) - Ask price
    - `mid` (decimal) - Mid price (calculated)
    - `spread` (decimal) - Spread between bid/ask
    - `broker_time` (timestamptz) - Broker's timestamp
    - `source` (text) - Data source identifier
    - `created_at` (timestamptz) - Record creation time

  ## Indexes
  - Fast lookups by symbol and time (critical for SL/TP monitoring)
  - Composite index for symbol + created_at queries

  ## RLS Policies
  - Authenticated users can read their price data
  - Service role can insert price data

  ## Notes
  - This table was referenced in code but never created in migrations
  - Critical for entry execution system and stop loss monitoring
  - Populated by Netlify functions (continuous-price-collector, etc.)
*/

-- Create realtime_prices table
CREATE TABLE IF NOT EXISTS realtime_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  bid decimal(15, 5) NOT NULL,
  ask decimal(15, 5) NOT NULL,
  mid decimal(15, 5) NOT NULL,
  spread decimal(15, 5) NOT NULL,
  broker_time timestamptz NOT NULL,
  source text NOT NULL DEFAULT 'unknown',
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE realtime_prices ENABLE ROW LEVEL SECURITY;

-- Index for fast symbol + time lookups (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_realtime_prices_symbol_created
ON realtime_prices(symbol, created_at DESC);

-- Index for time-based cleanup queries
CREATE INDEX IF NOT EXISTS idx_realtime_prices_created_at
ON realtime_prices(created_at DESC);

-- Index for broker time queries
CREATE INDEX IF NOT EXISTS idx_realtime_prices_broker_time
ON realtime_prices(broker_time DESC);

-- RLS Policies

-- Allow authenticated users to read price data
CREATE POLICY "Authenticated users can read realtime prices"
  ON realtime_prices FOR SELECT
  TO authenticated
  USING (true);

-- Allow service role to insert price data
CREATE POLICY "Service role can insert realtime prices"
  ON realtime_prices FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Allow anon to read prices (for public charts)
CREATE POLICY "Anonymous users can read realtime prices"
  ON realtime_prices FOR SELECT
  TO anon
  USING (true);

-- Optional: Auto-cleanup old prices (keep last 24 hours)
-- This keeps the table size manageable
CREATE OR REPLACE FUNCTION cleanup_old_realtime_prices()
RETURNS void AS $$
BEGIN
  DELETE FROM realtime_prices
  WHERE created_at < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Note: Auto-cleanup can be scheduled via pg_cron if needed
-- For now, manual cleanup via admin interface is sufficient
