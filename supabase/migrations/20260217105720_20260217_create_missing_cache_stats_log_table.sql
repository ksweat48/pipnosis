/*
  # Create missing cache_stats_log table

  This table was referenced by existing code (shared-intelligence-coordinator,
  freshness-block-logger) but did not exist in the database, causing 404 errors.

  1. New Tables
    - `cache_stats_log`
      - `id` (uuid, primary key)
      - `cache_tier` (text) - omega, alpha, scout, market_context, hybrid_orderflow
      - `symbol` (text, nullable)
      - `timeframe` (text, nullable)
      - `event_type` (text) - lookup, write, expire, warm, block
      - `hit_or_miss` (text, nullable)
      - `cache_age_seconds` (integer, nullable)
      - `llm_calls_saved` (integer, default 0)
      - `block_metadata` (jsonb, nullable) - additional block context
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on `cache_stats_log`
    - Authenticated users can insert and read their own stats
    - Service role has full access
*/

CREATE TABLE IF NOT EXISTS cache_stats_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_tier text NOT NULL,
  symbol text,
  timeframe text,
  event_type text NOT NULL,
  hit_or_miss text,
  cache_age_seconds integer,
  llm_calls_saved integer DEFAULT 0,
  block_metadata jsonb,
  created_at timestamptz DEFAULT now(),

  CONSTRAINT valid_cache_tier CHECK (cache_tier IN (
    'omega', 'alpha', 'scout',
    'market_context', 'hybrid_orderflow',
    'freshness_gate', 'shared_intelligence'
  )),
  CONSTRAINT valid_event_type CHECK (event_type IN ('lookup', 'write', 'expire', 'warm', 'block')),
  CONSTRAINT valid_hit_or_miss CHECK (hit_or_miss IS NULL OR hit_or_miss IN ('hit', 'miss'))
);

CREATE INDEX IF NOT EXISTS idx_cache_stats_created
  ON cache_stats_log(created_at);

CREATE INDEX IF NOT EXISTS idx_cache_stats_tier
  ON cache_stats_log(cache_tier, created_at);

ALTER TABLE cache_stats_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read cache stats"
  ON cache_stats_log FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert cache stats"
  ON cache_stats_log FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Service role full access cache stats"
  ON cache_stats_log FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
