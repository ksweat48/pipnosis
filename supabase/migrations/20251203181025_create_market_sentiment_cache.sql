/*
  # Market Sentiment Cache System

  ## Overview
  Creates infrastructure for Omega-7 Sentiment Brain to cache aggregated
  market sentiment analysis from multiple free sources.

  ## New Tables
  
  ### `market_sentiment_cache`
  Stores aggregated sentiment analysis with 10-minute cache duration.
  
  Columns:
  - `id` (uuid, primary key)
  - `sentiment_json` (jsonb) - Complete sentiment analysis result
  - `created_at` (timestamptz) - Cache timestamp
  - `expires_at` (timestamptz) - Cache expiry (10 minutes from creation)

  ## Security
  - RLS enabled
  - Authenticated users can read
  - Service role can write (automated sentiment updates)

  ## Indexes
  - `created_at` DESC for recent lookups
  - `expires_at` for cleanup queries

  ## Notes
  - Cache expires after 10 minutes
  - Multiple sentiment snapshots stored for trend analysis
  - JSON structure contains: sentiment, usd_strength, volatility, bias, warnings, confidence
*/

-- Create market_sentiment_cache table
CREATE TABLE IF NOT EXISTS market_sentiment_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sentiment_json jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  expires_at timestamptz DEFAULT (now() + interval '10 minutes') NOT NULL
);

-- Enable RLS
ALTER TABLE market_sentiment_cache ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Authenticated users can read sentiment"
  ON market_sentiment_cache
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can insert sentiment"
  ON market_sentiment_cache
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_sentiment_cache_created_at 
  ON market_sentiment_cache (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sentiment_cache_expires_at 
  ON market_sentiment_cache (expires_at);

-- Automatic cleanup function (remove expired entries after 1 hour)
CREATE OR REPLACE FUNCTION cleanup_expired_sentiment_cache()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM market_sentiment_cache
  WHERE created_at < now() - interval '1 hour';
END;
$$;

-- Comment for documentation
COMMENT ON TABLE market_sentiment_cache IS 'Caches Omega-7 sentiment analysis results for 10 minutes to reduce API costs';
COMMENT ON COLUMN market_sentiment_cache.sentiment_json IS 'Complete sentiment analysis: sentiment, usd_strength, volatility, bias, warnings, confidence, summary';
COMMENT ON COLUMN market_sentiment_cache.expires_at IS 'Cache expiry timestamp (created_at + 10 minutes)';
