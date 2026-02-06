/*
  # TIER7: Timeout and Performance Monitoring System

  1. New Tables
    - `alpha_evaluation_metrics` - Tracks symbol evaluation performance
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key)
      - `session_id` (uuid, foreign key, nullable)
      - `symbol` (text)
      - `market_session` (text) - asian/london/nyse/overlap/off_hours
      - `evaluation_duration_ms` (integer)
      - `timeout_limit_ms` (integer)
      - `did_timeout` (boolean)
      - `timeout_percentage` (numeric) - actual duration as % of limit
      - `decision_action` (text) - BUY/SELL/NO_TRADE
      - `decision_confidence` (integer)
      - `error_type` (text, nullable) - TIMEOUT_FAILURE/SYSTEM_ERROR/etc
      - `error_message` (text, nullable)
      - `llm_call_count` (integer, nullable)
      - `thesis_cache_hit` (boolean, nullable)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on `alpha_evaluation_metrics` table
    - Add policies for authenticated users to insert their own metrics
    - Add policies for service role to read all metrics

  3. Indexes
    - Index on user_id for user-specific queries
    - Index on symbol for symbol-specific analysis
    - Index on market_session for session performance analysis
    - Index on did_timeout for filtering timeout events
    - Index on created_at for time-series queries

  TIER7 FIX: This enables production monitoring to identify timeout patterns
  and optimize session-specific timeouts based on real-world data.
*/

-- Create alpha_evaluation_metrics table
CREATE TABLE IF NOT EXISTS alpha_evaluation_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  session_id uuid REFERENCES goal_sessions(id) ON DELETE SET NULL,
  symbol text NOT NULL,
  market_session text NOT NULL CHECK (market_session IN ('asian', 'london', 'nyse', 'overlap', 'off_hours')),
  evaluation_duration_ms integer NOT NULL CHECK (evaluation_duration_ms >= 0),
  timeout_limit_ms integer NOT NULL CHECK (timeout_limit_ms > 0),
  did_timeout boolean NOT NULL DEFAULT false,
  timeout_percentage numeric(5,2) NOT NULL CHECK (timeout_percentage >= 0),
  decision_action text NOT NULL CHECK (decision_action IN ('BUY', 'SELL', 'NO_TRADE')),
  decision_confidence integer NOT NULL CHECK (decision_confidence >= 0 AND decision_confidence <= 100),
  error_type text CHECK (error_type IN ('TIMEOUT_FAILURE', 'SYSTEM_ERROR', 'DATA_INTEGRITY', 'NONE')),
  error_message text,
  llm_call_count integer CHECK (llm_call_count >= 0),
  thesis_cache_hit boolean,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE alpha_evaluation_metrics ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can insert own evaluation metrics"
  ON alpha_evaluation_metrics
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read own evaluation metrics"
  ON alpha_evaluation_metrics
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access to evaluation metrics"
  ON alpha_evaluation_metrics
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_alpha_eval_metrics_user_id ON alpha_evaluation_metrics(user_id);
CREATE INDEX IF NOT EXISTS idx_alpha_eval_metrics_symbol ON alpha_evaluation_metrics(symbol);
CREATE INDEX IF NOT EXISTS idx_alpha_eval_metrics_session ON alpha_evaluation_metrics(market_session);
CREATE INDEX IF NOT EXISTS idx_alpha_eval_metrics_timeout ON alpha_evaluation_metrics(did_timeout);
CREATE INDEX IF NOT EXISTS idx_alpha_eval_metrics_created_at ON alpha_evaluation_metrics(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alpha_eval_metrics_error_type ON alpha_evaluation_metrics(error_type) WHERE error_type IS NOT NULL;

-- Create helper RPC for timeout statistics
CREATE OR REPLACE FUNCTION get_timeout_statistics(
  p_time_window_hours integer DEFAULT 24,
  p_symbol text DEFAULT NULL
)
RETURNS TABLE (
  market_session text,
  symbol text,
  total_evaluations bigint,
  timeout_count bigint,
  timeout_rate numeric,
  avg_duration_ms numeric,
  avg_timeout_percentage numeric,
  p95_duration_ms numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    aem.market_session,
    aem.symbol,
    COUNT(*)::bigint as total_evaluations,
    SUM(CASE WHEN aem.did_timeout THEN 1 ELSE 0 END)::bigint as timeout_count,
    ROUND((SUM(CASE WHEN aem.did_timeout THEN 1 ELSE 0 END)::numeric / COUNT(*)) * 100, 2) as timeout_rate,
    ROUND(AVG(aem.evaluation_duration_ms)::numeric, 0) as avg_duration_ms,
    ROUND(AVG(aem.timeout_percentage)::numeric, 2) as avg_timeout_percentage,
    ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY aem.evaluation_duration_ms)::numeric, 0) as p95_duration_ms
  FROM alpha_evaluation_metrics aem
  WHERE
    aem.created_at >= NOW() - (p_time_window_hours || ' hours')::interval
    AND (p_symbol IS NULL OR aem.symbol = p_symbol)
  GROUP BY aem.market_session, aem.symbol
  ORDER BY timeout_rate DESC, total_evaluations DESC;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_timeout_statistics(integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_timeout_statistics(integer, text) TO service_role;