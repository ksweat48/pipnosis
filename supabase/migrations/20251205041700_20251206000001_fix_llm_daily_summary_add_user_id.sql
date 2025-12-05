/*
  # Fix LLM Daily Token Summary - Add user_id

  ## Changes
  - Drop and recreate llm_daily_token_summary with user_id column
  - Update RLS policies to filter by user_id
  - Update aggregation function to group by user_id

  ## Why
  The hook useLLMTokenUsage tries to filter by user_id but the table didn't have it
*/

-- Drop the old table and recreate with user_id
DROP TABLE IF EXISTS llm_daily_token_summary CASCADE;

CREATE TABLE llm_daily_token_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  brain_name text NOT NULL,
  total_calls int NOT NULL DEFAULT 0,
  total_tokens bigint NOT NULL DEFAULT 0,
  total_cost_usd numeric(10, 6) NOT NULL DEFAULT 0,
  avg_tokens_per_call int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, date, brain_name)
);

-- Indexes
CREATE INDEX idx_daily_summary_user_date
  ON llm_daily_token_summary(user_id, date DESC, brain_name);

CREATE INDEX idx_daily_summary_date
  ON llm_daily_token_summary(date DESC);

-- Enable RLS
ALTER TABLE llm_daily_token_summary ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can read own daily summary"
  ON llm_daily_token_summary
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage daily summary"
  ON llm_daily_token_summary
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Update the aggregation function
CREATE OR REPLACE FUNCTION update_daily_token_summary()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO llm_daily_token_summary (
    user_id,
    date,
    brain_name,
    total_calls,
    total_tokens,
    total_cost_usd,
    avg_tokens_per_call,
    updated_at
  )
  SELECT
    user_id,
    timestamp::date as date,
    brain_name,
    COUNT(*) as total_calls,
    SUM(total_tokens) as total_tokens,
    SUM(estimated_cost_usd) as total_cost_usd,
    AVG(total_tokens)::int as avg_tokens_per_call,
    now() as updated_at
  FROM llm_token_usage
  WHERE timestamp::date = CURRENT_DATE
    AND user_id IS NOT NULL
  GROUP BY user_id, timestamp::date, brain_name
  ON CONFLICT (user_id, date, brain_name)
  DO UPDATE SET
    total_calls = EXCLUDED.total_calls,
    total_tokens = EXCLUDED.total_tokens,
    total_cost_usd = EXCLUDED.total_cost_usd,
    avg_tokens_per_call = EXCLUDED.avg_tokens_per_call,
    updated_at = now();
END;
$$;