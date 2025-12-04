/*
  # Omega-8 Hybrid Tracking System

  1. New Tables
    - `omega8_hybrid_usage`
      - Tracks when LLM is used vs deterministic-only
      - Monitors cost savings and performance
      - Enables A/B testing of confidence thresholds

  2. Security
    - Enable RLS
    - Allow authenticated users to read their own data
    - Service role can write

  3. Purpose
    - Track LLM usage percentage (target: 20-30%)
    - Measure token cost savings (target: 70-80% reduction)
    - Analyze when LLM actually helps vs hurts
    - Optimize confidence thresholds over time
*/

CREATE TABLE IF NOT EXISTS omega8_hybrid_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  timeframe text,
  confidence numeric NOT NULL,
  used_llm boolean NOT NULL DEFAULT false,
  tokens_used integer DEFAULT 0,
  deterministic_bias text,
  llm_bias text,
  final_bias text,
  trade_id uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE omega8_hybrid_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own omega8 usage"
  ON omega8_hybrid_usage FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can write omega8 usage"
  ON omega8_hybrid_usage FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_omega8_usage_user_created
  ON omega8_hybrid_usage(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_omega8_usage_llm_flag
  ON omega8_hybrid_usage(used_llm, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_omega8_usage_symbol
  ON omega8_hybrid_usage(symbol, created_at DESC);

COMMENT ON TABLE omega8_hybrid_usage IS 'Tracks Omega-8 hybrid decision-making: deterministic vs LLM usage';
COMMENT ON COLUMN omega8_hybrid_usage.used_llm IS 'True if LLM refinement was called (target: 20-30% of cases)';
COMMENT ON COLUMN omega8_hybrid_usage.tokens_used IS 'OpenAI tokens consumed (0 if deterministic-only)';
COMMENT ON COLUMN omega8_hybrid_usage.confidence IS 'Deterministic confidence score that triggered LLM decision';
