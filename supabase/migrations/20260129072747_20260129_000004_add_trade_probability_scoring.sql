/*
  # Add Trade Probability Scoring System

  1. Schema Updates
    - Extend session_intelligence_data.best_pairs JSONB to include tradeConfidence field
    - Add new table trade_probability_scores for historical tracking
    - Add index for efficient queries

  2. Description
    This migration enables the new Trade Probability Scoring feature that displays
    high-probability trade percentages for each symbol during active trading sessions.
    
  3. Fields Added
    - best_pairs[].tradeConfidence (0-100%): Calculated from technical indicators
    - best_pairs[].indicatorAlignment (optional): Shows which indicators are aligned
    - best_pairs[].lastCalculated (timestamp): When this score was computed
    
  4. Security
    - RLS policies inherit from session_intelligence_data
    - Trade probability data is read-only to users
    
  5. Governance & SSOT
    - Single source of truth: session_intelligence_data table
    - Probability scores are advisory only, do not affect Alpha's trading
    - Backwards compatible: existing queries work unchanged
*/

CREATE TABLE IF NOT EXISTS trade_probability_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_name text NOT NULL,
  symbol text NOT NULL,
  trade_direction text NOT NULL CHECK (trade_direction IN ('buy', 'sell')),
  confidence_score numeric NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 100),
  indicator_alignment jsonb DEFAULT '{}',
  calculated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE trade_probability_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own probability scores"
  ON trade_probability_scores FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert probability scores"
  ON trade_probability_scores FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE INDEX idx_trade_probability_scores_user_symbol
  ON trade_probability_scores(user_id, symbol, calculated_at DESC);

CREATE INDEX idx_trade_probability_scores_session
  ON trade_probability_scores(session_name, calculated_at DESC);
