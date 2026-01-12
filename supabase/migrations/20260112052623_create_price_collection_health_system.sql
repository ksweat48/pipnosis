/*
  # Price Collection Health Monitoring System

  1. Purpose
    - Track success/failure rates for price collection
    - Monitor which data sources are used
    - Identify patterns in collection failures
    - Enable operational alerts for degraded performance

  2. New Tables
    - `price_collection_health`
      - `id` (uuid, primary key)
      - `execution_id` (text) - Unique identifier for each collection run
      - `symbol` (text) - Currency pair/asset symbol
      - `source_attempted` (text) - Which source was tried (metaapi/finnhub/kraken)
      - `source_used` (text) - Which source successfully returned data
      - `success` (boolean) - Whether price was successfully saved
      - `attempt_number` (integer) - Retry attempt (1, 2, 3)
      - `latency_ms` (integer) - Time taken to fetch price
      - `error_message` (text, nullable) - Error details if failed
      - `created_at` (timestamptz)

  3. Indexes
    - created_at (for time-series queries)
    - symbol + created_at (for per-symbol analysis)
    - success (for failure rate calculation)

  4. Security
    - Enable RLS
    - Admin-only read access
*/

-- Create health tracking table
CREATE TABLE IF NOT EXISTS price_collection_health (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id text NOT NULL,
  symbol text NOT NULL,
  source_attempted text NOT NULL,
  source_used text,
  success boolean NOT NULL DEFAULT false,
  attempt_number integer NOT NULL DEFAULT 1,
  latency_ms integer,
  error_message text,
  created_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_price_collection_health_created_at
  ON price_collection_health (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_price_collection_health_symbol_time
  ON price_collection_health (symbol, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_price_collection_health_success
  ON price_collection_health (success);

CREATE INDEX IF NOT EXISTS idx_price_collection_health_execution_id
  ON price_collection_health (execution_id);

-- Enable RLS
ALTER TABLE price_collection_health ENABLE ROW LEVEL SECURITY;

-- Admin-only read access (fixed column name)
CREATE POLICY "Admins can read price collection health"
  ON price_collection_health
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- Service role can insert (Netlify functions)
CREATE POLICY "Service role can insert health metrics"
  ON price_collection_health
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Create function to get health summary for last N minutes
CREATE OR REPLACE FUNCTION get_price_collection_health_summary(
  minutes_back integer DEFAULT 60
)
RETURNS TABLE (
  symbol text,
  total_attempts bigint,
  successful bigint,
  failed bigint,
  success_rate numeric,
  avg_latency_ms numeric,
  primary_source_used text,
  fallback_count bigint
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    pch.symbol,
    COUNT(*) as total_attempts,
    COUNT(*) FILTER (WHERE pch.success = true) as successful,
    COUNT(*) FILTER (WHERE pch.success = false) as failed,
    ROUND(
      (COUNT(*) FILTER (WHERE pch.success = true)::numeric / COUNT(*)::numeric) * 100,
      2
    ) as success_rate,
    ROUND(AVG(pch.latency_ms)) as avg_latency_ms,
    MODE() WITHIN GROUP (ORDER BY pch.source_used) as primary_source_used,
    COUNT(*) FILTER (WHERE pch.attempt_number > 1) as fallback_count
  FROM price_collection_health pch
  WHERE pch.created_at > now() - (minutes_back || ' minutes')::interval
  GROUP BY pch.symbol
  ORDER BY success_rate ASC, pch.symbol;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users (admins can call this)
GRANT EXECUTE ON FUNCTION get_price_collection_health_summary TO authenticated;

-- Create function to get recent failures
CREATE OR REPLACE FUNCTION get_recent_price_collection_failures(
  limit_count integer DEFAULT 50
)
RETURNS TABLE (
  symbol text,
  source_attempted text,
  attempt_number integer,
  error_message text,
  created_at timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    pch.symbol,
    pch.source_attempted,
    pch.attempt_number,
    pch.error_message,
    pch.created_at
  FROM price_collection_health pch
  WHERE pch.success = false
  ORDER BY pch.created_at DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION get_recent_price_collection_failures TO authenticated;

-- Create cleanup function (keep last 7 days only)
CREATE OR REPLACE FUNCTION cleanup_old_price_collection_health()
RETURNS void AS $$
BEGIN
  DELETE FROM price_collection_health
  WHERE created_at < now() - interval '7 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to service role (for scheduled cleanup)
GRANT EXECUTE ON FUNCTION cleanup_old_price_collection_health TO service_role;
