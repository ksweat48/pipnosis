/*
  # LLM Token Usage Tracking System

  ## Purpose
  Track OpenAI API usage across all 11 LLM brains (Alpha + 10 Omegas) for:
  - Cost monitoring and optimization
  - Brain performance analysis
  - Budget alerts and control
  - Cost per trade calculations

  ## New Tables

  ### `llm_token_usage`
  Tracks every LLM API call with detailed token and cost data

  ### `llm_daily_token_summary`
  Pre-aggregated daily summary for performance

  ## Security
  - RLS enabled on all tables
  - Users can only read their own token usage
  - Service role has full access
*/

-- =====================================================
-- TABLE: llm_token_usage
-- =====================================================

CREATE TABLE IF NOT EXISTS llm_token_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brain_name text NOT NULL CHECK (brain_name IN (
    'Alpha',
    'Omega-1', 'Omega-2', 'Omega-3', 'Omega-4', 'Omega-5',
    'Omega-6', 'Omega-7', 'Omega-8', 'Omega-9', 'Omega-10'
  )),
  model text NOT NULL CHECK (model IN ('gpt-4o', 'gpt-4o-mini')),
  prompt_tokens int NOT NULL DEFAULT 0,
  completion_tokens int NOT NULL DEFAULT 0,
  total_tokens int NOT NULL DEFAULT 0,
  estimated_cost_usd numeric(10, 6) NOT NULL DEFAULT 0,
  context_type text NOT NULL CHECK (context_type IN (
    'vote', 'fusion', 'sentiment', 'meta_reasoning',
    'mid_trade', 'strategy_planning', 'execution'
  )),
  timestamp timestamptz NOT NULL DEFAULT now(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_token_usage_brain_timestamp
  ON llm_token_usage(brain_name, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_token_usage_timestamp
  ON llm_token_usage(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_token_usage_user_timestamp
  ON llm_token_usage(user_id, timestamp DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_token_usage_session
  ON llm_token_usage(session_id, timestamp DESC)
  WHERE session_id IS NOT NULL;

-- =====================================================
-- TABLE: llm_daily_token_summary
-- =====================================================

CREATE TABLE IF NOT EXISTS llm_daily_token_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL,
  brain_name text NOT NULL,
  total_calls int NOT NULL DEFAULT 0,
  total_tokens bigint NOT NULL DEFAULT 0,
  total_cost_usd numeric(10, 6) NOT NULL DEFAULT 0,
  avg_tokens_per_call int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(date, brain_name)
);

CREATE INDEX IF NOT EXISTS idx_daily_summary_date
  ON llm_daily_token_summary(date DESC, brain_name);

-- =====================================================
-- RLS POLICIES
-- =====================================================

ALTER TABLE llm_token_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_daily_token_summary ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own token usage"
  ON llm_token_usage
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert token usage"
  ON llm_token_usage
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can read all token usage"
  ON llm_token_usage
  FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "Users can read daily summary"
  ON llm_daily_token_summary
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can manage daily summary"
  ON llm_daily_token_summary
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- FUNCTION: Update daily summary
-- =====================================================

CREATE OR REPLACE FUNCTION update_daily_token_summary()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO llm_daily_token_summary (
    date,
    brain_name,
    total_calls,
    total_tokens,
    total_cost_usd,
    avg_tokens_per_call,
    updated_at
  )
  SELECT
    timestamp::date as date,
    brain_name,
    COUNT(*) as total_calls,
    SUM(total_tokens) as total_tokens,
    SUM(estimated_cost_usd) as total_cost_usd,
    AVG(total_tokens)::int as avg_tokens_per_call,
    now() as updated_at
  FROM llm_token_usage
  WHERE timestamp::date = CURRENT_DATE
  GROUP BY timestamp::date, brain_name
  ON CONFLICT (date, brain_name)
  DO UPDATE SET
    total_calls = EXCLUDED.total_calls,
    total_tokens = EXCLUDED.total_tokens,
    total_cost_usd = EXCLUDED.total_cost_usd,
    avg_tokens_per_call = EXCLUDED.avg_tokens_per_call,
    updated_at = now();
END;
$$;