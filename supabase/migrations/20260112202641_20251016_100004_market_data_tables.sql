/*
  # Market Data Infrastructure

  1. Tables
    - market_data (for live price caching)
    - market_data_subscriptions

  2. Indexes
    - Performance indexes for market data queries

  3. Triggers
    - Auto-update timestamps
*/

-- Market Data Table (for live price caching)
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

-- Market Data Subscriptions Table
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

-- Market Data Indexes
CREATE INDEX IF NOT EXISTS idx_market_data_symbol_timeframe_timestamp
  ON market_data(symbol, timeframe, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_market_data_symbol ON market_data(symbol);
CREATE INDEX IF NOT EXISTS idx_market_data_timeframe ON market_data(timeframe);
CREATE INDEX IF NOT EXISTS idx_market_data_timestamp ON market_data(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_market_data_created_at ON market_data(created_at DESC);

-- Market Data Subscriptions Index
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON market_data_subscriptions(status);

-- Triggers for updated_at
DROP TRIGGER IF EXISTS market_data_updated_at ON market_data;
CREATE TRIGGER market_data_updated_at
  BEFORE UPDATE ON market_data
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS subscriptions_updated_at ON market_data_subscriptions;
CREATE TRIGGER subscriptions_updated_at
  BEFORE UPDATE ON market_data_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();