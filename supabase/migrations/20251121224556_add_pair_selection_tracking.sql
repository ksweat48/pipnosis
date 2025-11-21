/*
  # Add Pair Selection Tracking System

  ## Purpose
  Track LLM pair selection decisions and accuracy over time for the new daily learning system.
  Each day, the AI selects ONE optimal pair to trade based on comprehensive analysis.

  ## Changes
  1. Add pair selection columns to synthetic_backtest_sessions
  2. Create pair_selection_history table for tracking accuracy
  3. Add indexes for performance

  ## Security
  - Enable RLS on all new tables
  - Users can only access their own pair selection data
*/

-- Add pair selection fields to synthetic_backtest_sessions
ALTER TABLE synthetic_backtest_sessions
ADD COLUMN IF NOT EXISTS selected_pair text,
ADD COLUMN IF NOT EXISTS pair_confidence numeric,
ADD COLUMN IF NOT EXISTS pair_selection_reasoning text;

COMMENT ON COLUMN synthetic_backtest_sessions.selected_pair IS
'The single pair chosen by LLM for this daily session (e.g., GBPUSD)';

COMMENT ON COLUMN synthetic_backtest_sessions.pair_confidence IS
'LLM confidence score (0-100) for selected pair based on analysis';

COMMENT ON COLUMN synthetic_backtest_sessions.pair_selection_reasoning IS
'LLM explanation for why this pair was selected';

-- Create pair_selection_history table to track LLM accuracy
CREATE TABLE IF NOT EXISTS pair_selection_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  expected_confidence numeric NOT NULL CHECK (expected_confidence >= 0 AND expected_confidence <= 100),
  actual_win_rate numeric DEFAULT 0,
  accuracy numeric DEFAULT 0,
  reasoning text,
  metrics jsonb DEFAULT '{}'::jsonb,
  session_date timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Add indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_pair_selection_history_user
  ON pair_selection_history(user_id, session_date DESC);

CREATE INDEX IF NOT EXISTS idx_pair_selection_history_symbol
  ON pair_selection_history(user_id, symbol, session_date DESC);

-- Add helpful comments
COMMENT ON TABLE pair_selection_history IS
'Tracks LLM pair selection decisions and measures accuracy (expected confidence vs actual win rate)';

COMMENT ON COLUMN pair_selection_history.expected_confidence IS
'LLM predicted confidence/win rate for this pair (0-100)';

COMMENT ON COLUMN pair_selection_history.actual_win_rate IS
'Actual win rate achieved for the session with this pair (updated after session completes)';

COMMENT ON COLUMN pair_selection_history.accuracy IS
'Accuracy score: 100 - abs(expected - actual)';

COMMENT ON COLUMN pair_selection_history.metrics IS
'Detailed metrics used in selection: volatility, trend strength, pattern quality, etc.';

-- Enable Row Level Security
ALTER TABLE pair_selection_history ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own pair selection history
CREATE POLICY "Users view own pair history"
  ON pair_selection_history
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own pair selections
CREATE POLICY "Users insert own pair history"
  ON pair_selection_history
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own pair selections (for accuracy updates)
CREATE POLICY "Users update own pair history"
  ON pair_selection_history
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Create function to calculate pair selection accuracy statistics
CREATE OR REPLACE FUNCTION calculate_pair_selection_accuracy(
  p_user_id uuid,
  p_days integer DEFAULT 30
)
RETURNS TABLE (
  symbol text,
  selections_count integer,
  avg_accuracy numeric,
  avg_expected_confidence numeric,
  avg_actual_win_rate numeric,
  calibration_drift numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    psh.symbol,
    COUNT(*)::integer as selections_count,
    AVG(psh.accuracy) as avg_accuracy,
    AVG(psh.expected_confidence) as avg_expected_confidence,
    AVG(psh.actual_win_rate) as avg_actual_win_rate,
    AVG(psh.expected_confidence - psh.actual_win_rate) as calibration_drift
  FROM pair_selection_history psh
  WHERE psh.user_id = p_user_id
    AND psh.session_date >= NOW() - (p_days || ' days')::interval
    AND psh.actual_win_rate > 0
  GROUP BY psh.symbol
  ORDER BY avg_accuracy DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION calculate_pair_selection_accuracy(uuid, integer) TO authenticated;

COMMENT ON FUNCTION calculate_pair_selection_accuracy IS
'Calculates pair selection accuracy statistics per symbol for a given time period';
