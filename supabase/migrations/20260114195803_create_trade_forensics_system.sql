/*
  # Create Trade Forensics System

  ## Purpose
  Post-trade analysis system for AI learning and continuous improvement.
  Captures entry quality, thesis validation, and outcome classification.

  ## New Tables
  - `trade_forensics`
    - Links to goal_session_trades
    - Stores thesis type and entry requirements analysis
    - Captures execution quality metrics (MFE, MAE, duration)
    - Classifies outcomes: good_loss, logic_failure, execution_error, win
    - Stores Alpha confidence and EQS at entry for calibration

  ## Security
  - Enable RLS
  - Users can only read their own forensics
  - Service role can write forensics (post-trade logging)

  ## Learning Features
  - Thesis win rate tracking
  - EQS correlation with outcomes
  - Alpha confidence calibration
  - Entry quality vs result analysis
  - Pattern discovery for failures
*/

-- Create trade forensics table
CREATE TABLE IF NOT EXISTS trade_forensics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id uuid NOT NULL REFERENCES goal_session_trades(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid REFERENCES goal_sessions(id) ON DELETE CASCADE,
  
  -- Thesis and strategy
  thesis text NOT NULL CHECK (thesis IN (
    'momentum_scalp',
    'liquidity_sweep_reversal',
    'trend_pullback',
    'breakout_continuation',
    'mean_reversion',
    'failed_move',
    'range_extreme'
  )),
  style_intent text NOT NULL CHECK (style_intent IN ('SCALP', 'MICRO_INTRADAY', 'INTRADAY')),
  execution_preference text NOT NULL CHECK (execution_preference IN ('IMMEDIATE', 'WAIT_PULLBACK', 'WAIT_CONFIRMATION')),
  
  -- Entry quality at execution
  eqs_at_entry numeric NOT NULL CHECK (eqs_at_entry >= 0 AND eqs_at_entry <= 100),
  alpha_confidence numeric NOT NULL CHECK (alpha_confidence >= 0 AND alpha_confidence <= 100),
  requirements_met jsonb NOT NULL DEFAULT '{}',
  requirements_missed jsonb NOT NULL DEFAULT '{}',
  critical_gaps text[] DEFAULT '{}',
  
  -- Execution metrics
  entry_price numeric NOT NULL,
  entry_slippage_pips numeric DEFAULT 0,
  time_to_fill_seconds integer,
  
  -- Outcome metrics
  outcome text NOT NULL CHECK (outcome IN ('win', 'loss', 'breakeven')),
  pnl_usd numeric NOT NULL,
  pnl_percent numeric NOT NULL,
  duration_minutes integer NOT NULL,
  mfe_pips numeric,
  mae_pips numeric,
  mfe_reached_at timestamptz,
  mae_reached_at timestamptz,
  
  -- Classification
  classification text NOT NULL CHECK (classification IN (
    'good_loss',
    'logic_failure',
    'execution_error',
    'good_win',
    'lucky_win'
  )),
  classification_reason text,
  
  -- Learning insights
  thesis_validated boolean NOT NULL,
  entry_quality_validated boolean NOT NULL,
  alpha_confidence_calibrated boolean NOT NULL,
  lessons_learned text[] DEFAULT '{}',
  
  -- Metadata
  created_at timestamptz DEFAULT now(),
  analyzed_at timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_trade_forensics_trade_id ON trade_forensics(trade_id);
CREATE INDEX IF NOT EXISTS idx_trade_forensics_user_id ON trade_forensics(user_id);
CREATE INDEX IF NOT EXISTS idx_trade_forensics_session_id ON trade_forensics(session_id);
CREATE INDEX IF NOT EXISTS idx_trade_forensics_thesis ON trade_forensics(thesis);
CREATE INDEX IF NOT EXISTS idx_trade_forensics_outcome ON trade_forensics(outcome);
CREATE INDEX IF NOT EXISTS idx_trade_forensics_classification ON trade_forensics(classification);
CREATE INDEX IF NOT EXISTS idx_trade_forensics_created_at ON trade_forensics(created_at DESC);

-- Composite indexes for analytics
CREATE INDEX IF NOT EXISTS idx_trade_forensics_thesis_outcome ON trade_forensics(thesis, outcome);
CREATE INDEX IF NOT EXISTS idx_trade_forensics_user_thesis ON trade_forensics(user_id, thesis);

-- Enable RLS
ALTER TABLE trade_forensics ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own forensics"
  ON trade_forensics FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert forensics"
  ON trade_forensics FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update forensics"
  ON trade_forensics FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Analytics view for thesis performance
CREATE OR REPLACE VIEW trade_forensics_analytics AS
SELECT
  user_id,
  thesis,
  style_intent,
  COUNT(*) as total_trades,
  COUNT(*) FILTER (WHERE outcome = 'win') as wins,
  COUNT(*) FILTER (WHERE outcome = 'loss') as losses,
  ROUND(AVG(eqs_at_entry), 1) as avg_eqs,
  ROUND(AVG(alpha_confidence), 1) as avg_confidence,
  ROUND(SUM(pnl_usd), 2) as total_pnl,
  ROUND(AVG(duration_minutes), 0) as avg_duration_minutes,
  ROUND(AVG(mfe_pips), 1) as avg_mfe_pips,
  ROUND(AVG(mae_pips), 1) as avg_mae_pips,
  COUNT(*) FILTER (WHERE classification = 'logic_failure') as logic_failures,
  COUNT(*) FILTER (WHERE classification = 'execution_error') as execution_errors,
  ROUND(
    COUNT(*) FILTER (WHERE outcome = 'win')::numeric / 
    NULLIF(COUNT(*), 0) * 100, 
    1
  ) as win_rate_percent
FROM trade_forensics
GROUP BY user_id, thesis, style_intent;

-- Grant access to analytics view
GRANT SELECT ON trade_forensics_analytics TO authenticated;

-- Function to get thesis performance for a user
CREATE OR REPLACE FUNCTION get_thesis_performance(p_user_id uuid)
RETURNS TABLE (
  thesis text,
  total_trades bigint,
  win_rate numeric,
  avg_eqs numeric,
  avg_confidence numeric,
  total_pnl numeric,
  logic_failures bigint
) 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    tf.thesis,
    COUNT(*) as total_trades,
    ROUND(
      COUNT(*) FILTER (WHERE tf.outcome = 'win')::numeric / 
      NULLIF(COUNT(*), 0) * 100, 
      1
    ) as win_rate,
    ROUND(AVG(tf.eqs_at_entry), 1) as avg_eqs,
    ROUND(AVG(tf.alpha_confidence), 1) as avg_confidence,
    ROUND(SUM(tf.pnl_usd), 2) as total_pnl,
    COUNT(*) FILTER (WHERE tf.classification = 'logic_failure') as logic_failures
  FROM trade_forensics tf
  WHERE tf.user_id = p_user_id
  GROUP BY tf.thesis
  ORDER BY total_trades DESC;
END;
$$;

-- Function to get EQS calibration data
CREATE OR REPLACE FUNCTION get_eqs_calibration(p_user_id uuid, p_thesis text DEFAULT NULL)
RETURNS TABLE (
  eqs_bucket text,
  total_trades bigint,
  win_rate numeric,
  avg_pnl numeric
) 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    CASE
      WHEN tf.eqs_at_entry >= 80 THEN '80-100'
      WHEN tf.eqs_at_entry >= 60 THEN '60-79'
      WHEN tf.eqs_at_entry >= 40 THEN '40-59'
      WHEN tf.eqs_at_entry >= 20 THEN '20-39'
      ELSE '0-19'
    END as eqs_bucket,
    COUNT(*) as total_trades,
    ROUND(
      COUNT(*) FILTER (WHERE tf.outcome = 'win')::numeric / 
      NULLIF(COUNT(*), 0) * 100, 
      1
    ) as win_rate,
    ROUND(AVG(tf.pnl_usd), 2) as avg_pnl
  FROM trade_forensics tf
  WHERE tf.user_id = p_user_id
    AND (p_thesis IS NULL OR tf.thesis = p_thesis)
  GROUP BY eqs_bucket
  ORDER BY eqs_bucket DESC;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_thesis_performance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_eqs_calibration(uuid, text) TO authenticated;
