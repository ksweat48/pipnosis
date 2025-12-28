/*
  # Create Sentiment Health Monitoring System

  ## Purpose
  Track the health and availability of sentiment data sources to ensure reliable
  market sentiment analysis for Omega-7 sentiment brain.

  ## Tables Created
  1. `sentiment_source_health`
     - Tracks success/failure rate for each sentiment source
     - Records response times and error details
     - Enables monitoring dashboard and alerts

  2. `sentiment_health_summary`
     - Daily aggregated metrics per source
     - Success rate, average latency, error counts
     - Used for trending and long-term analysis

  ## Security
  - RLS enabled on all tables
  - Admin users can view all health data
  - Regular users cannot access health data (admin dashboard only)

  ## Monitoring Use Cases
  - Dashboard widget showing current source status
  - Alert when sentiment degraded for > 1 hour
  - Track API quota usage to prevent failures
  - Identify problematic sources for replacement
*/

-- Create sentiment source health tracking table
CREATE TABLE IF NOT EXISTS sentiment_source_health (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name text NOT NULL CHECK (source_name IN ('finnhub', 'fmp', 'reddit', 'feargreed', 'coingecko', 'newsapi', 'alphavantage')),
  request_timestamp timestamptz NOT NULL DEFAULT now(),
  success boolean NOT NULL,
  response_time_ms integer,
  error_message text,
  http_status integer,
  items_fetched integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create index for fast lookups by source and time
CREATE INDEX IF NOT EXISTS idx_sentiment_health_source_time
  ON sentiment_source_health(source_name, request_timestamp DESC);

-- Create index for recent failures
CREATE INDEX IF NOT EXISTS idx_sentiment_health_failures
  ON sentiment_source_health(source_name, success, request_timestamp DESC)
  WHERE success = false;

-- Enable RLS
ALTER TABLE sentiment_source_health ENABLE ROW LEVEL SECURITY;

-- Admin-only access policy
CREATE POLICY "Admin can view sentiment health"
  ON sentiment_source_health
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- Service role can insert health check results
CREATE POLICY "Service can insert sentiment health checks"
  ON sentiment_source_health
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Create daily summary table for aggregated metrics
CREATE TABLE IF NOT EXISTS sentiment_health_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name text NOT NULL CHECK (source_name IN ('finnhub', 'fmp', 'reddit', 'feargreed', 'coingecko', 'newsapi', 'alphavantage')),
  summary_date date NOT NULL,
  total_requests integer NOT NULL DEFAULT 0,
  successful_requests integer NOT NULL DEFAULT 0,
  failed_requests integer NOT NULL DEFAULT 0,
  success_rate numeric(5, 2),
  avg_response_time_ms numeric(10, 2),
  total_items_fetched integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_name, summary_date)
);

-- Create index for date-based queries
CREATE INDEX IF NOT EXISTS idx_sentiment_summary_date
  ON sentiment_health_summary(source_name, summary_date DESC);

-- Enable RLS
ALTER TABLE sentiment_health_summary ENABLE ROW LEVEL SECURITY;

-- Admin-only access policy
CREATE POLICY "Admin can view sentiment health summary"
  ON sentiment_health_summary
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- Create function to aggregate daily summaries
CREATE OR REPLACE FUNCTION update_sentiment_health_summary()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO sentiment_health_summary (
    source_name,
    summary_date,
    total_requests,
    successful_requests,
    failed_requests,
    success_rate,
    avg_response_time_ms,
    total_items_fetched,
    updated_at
  )
  SELECT
    source_name,
    CURRENT_DATE - INTERVAL '1 day' as summary_date,
    COUNT(*) as total_requests,
    SUM(CASE WHEN success THEN 1 ELSE 0 END) as successful_requests,
    SUM(CASE WHEN NOT success THEN 1 ELSE 0 END) as failed_requests,
    ROUND(100.0 * SUM(CASE WHEN success THEN 1 ELSE 0 END)::numeric / COUNT(*)::numeric, 2) as success_rate,
    ROUND(AVG(response_time_ms)::numeric, 2) as avg_response_time_ms,
    SUM(items_fetched) as total_items_fetched,
    now() as updated_at
  FROM sentiment_source_health
  WHERE DATE(request_timestamp) = CURRENT_DATE - INTERVAL '1 day'
  GROUP BY source_name
  ON CONFLICT (source_name, summary_date)
  DO UPDATE SET
    total_requests = EXCLUDED.total_requests,
    successful_requests = EXCLUDED.successful_requests,
    failed_requests = EXCLUDED.failed_requests,
    success_rate = EXCLUDED.success_rate,
    avg_response_time_ms = EXCLUDED.avg_response_time_ms,
    total_items_fetched = EXCLUDED.total_items_fetched,
    updated_at = now();
END;
$$;

-- Create function to get current health status for all sources
CREATE OR REPLACE FUNCTION get_sentiment_health_status()
RETURNS TABLE (
  source_name text,
  last_success timestamptz,
  last_failure timestamptz,
  recent_success_rate numeric,
  avg_latency_ms numeric,
  is_healthy boolean,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH recent_checks AS (
    SELECT
      ssh.source_name,
      ssh.success,
      ssh.request_timestamp,
      ssh.response_time_ms,
      ROW_NUMBER() OVER (PARTITION BY ssh.source_name ORDER BY ssh.request_timestamp DESC) as rn
    FROM sentiment_source_health ssh
    WHERE ssh.request_timestamp >= now() - INTERVAL '1 hour'
  ),
  health_metrics AS (
    SELECT
      rc.source_name,
      MAX(CASE WHEN rc.success THEN rc.request_timestamp END) as last_success,
      MAX(CASE WHEN NOT rc.success THEN rc.request_timestamp END) as last_failure,
      ROUND(100.0 * SUM(CASE WHEN rc.success THEN 1 ELSE 0 END)::numeric / COUNT(*)::numeric, 2) as success_rate,
      ROUND(AVG(CASE WHEN rc.success THEN rc.response_time_ms END)::numeric, 2) as avg_latency
    FROM recent_checks rc
    WHERE rc.rn <= 10
    GROUP BY rc.source_name
  )
  SELECT
    hm.source_name,
    hm.last_success,
    hm.last_failure,
    hm.success_rate,
    hm.avg_latency,
    CASE
      WHEN hm.success_rate >= 80 AND (hm.last_failure IS NULL OR hm.last_success > hm.last_failure) THEN true
      ELSE false
    END as is_healthy,
    CASE
      WHEN hm.success_rate >= 90 THEN 'excellent'
      WHEN hm.success_rate >= 70 THEN 'good'
      WHEN hm.success_rate >= 50 THEN 'degraded'
      ELSE 'failing'
    END as status
  FROM health_metrics hm
  ORDER BY hm.source_name;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION update_sentiment_health_summary() TO service_role;
GRANT EXECUTE ON FUNCTION get_sentiment_health_status() TO authenticated;

-- Add helpful comment
COMMENT ON TABLE sentiment_source_health IS 'Tracks real-time health metrics for sentiment data sources used by Omega-7';
COMMENT ON TABLE sentiment_health_summary IS 'Daily aggregated health metrics for sentiment data sources';
COMMENT ON FUNCTION get_sentiment_health_status() IS 'Returns current health status for all sentiment sources based on recent activity';
