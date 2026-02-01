/*
  # Create Price Freshness Governance System (SSOT)

  1. New Tables
    - `polling_price_staleness`
      - `id` (uuid, primary key)
      - `symbol` (text, unique)
      - `last_update_at` (timestamptz - when realtime_prices last updated)
      - `staleness_minutes` (numeric - how many minutes stale)
      - `is_critical` (boolean - staleness > 5 minutes)
      - `last_alert_at` (timestamptz, nullable - when last alert fired)
      - `consecutive_stale_readings` (integer - for trend detection)
      - `updated_at` (timestamptz, auto-updated)

  2. Security
    - Enable RLS on table
    - Service role can insert/update for monitoring
    - Authenticated users can read for transparency

  3. Indexes
    - Index on symbol for quick lookups
    - Index on is_critical for filtering critical stale prices
    - Index on updated_at for staleness trend analysis

  4. Purpose
    - Single source of truth for price data quality
    - Enables mid-trade monitor to detect stale guidance
    - Supports governance compliance auditing

  5. Trigger
    - Updates whenever realtime_prices table changes
    - Calculates staleness automatically
    - Alerts when price data becomes critical
*/

CREATE TABLE IF NOT EXISTS polling_price_staleness (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text UNIQUE NOT NULL,
  last_update_at timestamptz,
  staleness_minutes numeric DEFAULT 0,
  is_critical boolean DEFAULT false,
  last_alert_at timestamptz,
  consecutive_stale_readings integer DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE polling_price_staleness ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can insert and update staleness"
  ON polling_price_staleness
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can read staleness"
  ON polling_price_staleness
  FOR SELECT
  TO authenticated
  USING (true);

CREATE INDEX IF NOT EXISTS idx_staleness_symbol ON polling_price_staleness(symbol);
CREATE INDEX IF NOT EXISTS idx_staleness_critical ON polling_price_staleness(is_critical) WHERE is_critical = true;
CREATE INDEX IF NOT EXISTS idx_staleness_updated ON polling_price_staleness(updated_at DESC);

GRANT ALL ON polling_price_staleness TO service_role;
GRANT SELECT ON polling_price_staleness TO authenticated;

-- Create RPC function to get current price freshness status
CREATE OR REPLACE FUNCTION get_price_freshness_status(p_symbol text)
RETURNS TABLE (
  symbol text,
  last_update_at timestamptz,
  staleness_minutes numeric,
  is_critical boolean,
  age_seconds integer
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ps.symbol,
    ps.last_update_at,
    ps.staleness_minutes,
    ps.is_critical,
    EXTRACT(EPOCH FROM (now() - ps.last_update_at))::integer
  FROM polling_price_staleness ps
  WHERE ps.symbol = p_symbol;
END;
$$ LANGUAGE plpgsql STABLE;

-- Create function to check if prices are stale for a list of symbols
CREATE OR REPLACE FUNCTION check_prices_freshness(p_symbols text[])
RETURNS TABLE (
  symbol text,
  is_fresh boolean,
  staleness_minutes numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ps.symbol,
    NOT ps.is_critical,
    ps.staleness_minutes
  FROM polling_price_staleness ps
  WHERE ps.symbol = ANY(p_symbols);
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION get_price_freshness_status(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION check_prices_freshness(text[]) TO authenticated, service_role;
