/*
  # LLM Cost Optimization Tables

  1. New Tables
    - `llm_cost_tracking` - Track all LLM API calls and costs
    - `llm_pattern_cache` - Store winning patterns for reuse

  2. Security
    - Enable RLS on both tables
    - Users can only access their own data

  3. Indexes
    - Optimize queries by user_id, session_id, timestamp
    - Pattern matching queries by symbol, trend, volatility
*/

-- Cost tracking table
CREATE TABLE IF NOT EXISTS llm_cost_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  layer_name text NOT NULL,
  model_used text NOT NULL,
  tokens_input integer NOT NULL DEFAULT 0,
  tokens_output integer NOT NULL DEFAULT 0,
  cost_usd decimal(10, 6) NOT NULL DEFAULT 0,
  context jsonb DEFAULT '{}'::jsonb,
  timestamp timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Pattern cache table
CREATE TABLE IF NOT EXISTS llm_pattern_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  trend text NOT NULL,
  volatility text NOT NULL,
  trigger_type text NOT NULL,
  setup_quality decimal(5, 2) NOT NULL DEFAULT 0,
  decision_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  outcome text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Indexes for cost tracking
CREATE INDEX IF NOT EXISTS idx_llm_cost_user_session
  ON llm_cost_tracking(user_id, session_id);

CREATE INDEX IF NOT EXISTS idx_llm_cost_timestamp
  ON llm_cost_tracking(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_llm_cost_layer
  ON llm_cost_tracking(layer_name);

-- Indexes for pattern cache
CREATE INDEX IF NOT EXISTS idx_pattern_cache_user_symbol
  ON llm_pattern_cache(user_id, symbol);

CREATE INDEX IF NOT EXISTS idx_pattern_cache_created
  ON llm_pattern_cache(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pattern_cache_outcome
  ON llm_pattern_cache(outcome);

-- Enable RLS
ALTER TABLE llm_cost_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_pattern_cache ENABLE ROW LEVEL SECURITY;

-- RLS Policies for llm_cost_tracking
CREATE POLICY "Users can view own cost data"
  ON llm_cost_tracking
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own cost data"
  ON llm_cost_tracking
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies for llm_pattern_cache
CREATE POLICY "Users can view own patterns"
  ON llm_pattern_cache
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own patterns"
  ON llm_pattern_cache
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own patterns"
  ON llm_pattern_cache
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);