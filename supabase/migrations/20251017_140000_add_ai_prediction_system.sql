/*
  # AI Prediction System for Auto Trading

  1. Purpose
    - Store AI predictions for when each pair might reach entry conditions
    - Track indicator status and proximity to required thresholds
    - Enable dynamic scan scheduling based on predicted entry times
    - Record prediction accuracy for continuous learning

  2. New Tables
    - `ai_pair_predictions`
      - Stores predicted entry time and required conditions per pair
      - Tracks which conditions are met vs pending
      - Records condition proximity percentages

    - `ai_pair_analysis_snapshots`
      - Stores complete market state for each pair at scan time
      - Includes all Pipnosis indicators with values and status
      - Records candle patterns, sentiment, and trade history context

    - `ai_prediction_accuracy`
      - Tracks prediction accuracy comparing estimated vs actual times
      - Records which indicator combinations yield best predictions
      - Enables learning and improvement of prediction algorithm

  3. Security
    - RLS enabled on all tables
    - Users can only access their own predictions and analysis
*/

-- Create ai_pair_predictions table
CREATE TABLE IF NOT EXISTS ai_pair_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  session_id uuid,
  scan_cycle_id text NOT NULL,
  symbol text NOT NULL,
  timeframe text NOT NULL DEFAULT 'M15',

  -- Prediction data
  predicted_entry_time timestamptz,
  prediction_confidence numeric(5,2) DEFAULT 0,
  estimated_minutes_to_entry integer,
  next_scan_scheduled_at timestamptz,

  -- Condition tracking
  conditions_required jsonb DEFAULT '[]'::jsonb,
  conditions_met jsonb DEFAULT '[]'::jsonb,
  conditions_pending jsonb DEFAULT '[]'::jsonb,
  condition_proximity jsonb DEFAULT '{}'::jsonb,

  -- Entry readiness
  readiness_status text DEFAULT 'far' CHECK (readiness_status IN ('ready', 'close', 'far', 'not_viable')),
  readiness_percentage numeric(5,2) DEFAULT 0,

  -- Metadata
  current_price numeric(12,5),
  target_entry_price numeric(12,5),
  predicted_direction text CHECK (predicted_direction IN ('BUY', 'SELL', 'NEUTRAL')),

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  expires_at timestamptz,

  CONSTRAINT unique_user_symbol_scan UNIQUE(user_id, symbol, scan_cycle_id)
);

-- Create ai_pair_analysis_snapshots table
CREATE TABLE IF NOT EXISTS ai_pair_analysis_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  session_id uuid,
  prediction_id uuid REFERENCES ai_pair_predictions(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  timeframe text NOT NULL DEFAULT 'M15',

  -- Current price info
  current_price numeric(12,5) NOT NULL,
  spread_from_vwap numeric(12,5),
  spread_from_ema9 numeric(12,5),

  -- RSI Analysis
  rsi_value numeric(5,2),
  rsi_status text CHECK (rsi_status IN ('OVERBOUGHT', 'OVERSOLD', 'NEUTRAL')),

  -- VWAP Analysis
  vwap_value numeric(12,5),
  vwap_position text CHECK (vwap_position IN ('ABOVE', 'BELOW', 'NEAR')),
  vwap_spread numeric(12,5),

  -- Volume Analysis
  volume_change_percent numeric(8,2),
  volume_status text CHECK (volume_status IN ('LOW', 'STABLE', 'HIGH')),
  volume_20bar_avg numeric(20,5),

  -- ATR Analysis
  atr_value numeric(12,8),
  atr_status text CHECK (atr_status IN ('LOW', 'NORMAL', 'HIGH')),

  -- EMA Trend Info
  ema9_value numeric(12,5),
  ema21_value numeric(12,5),
  ema_crossover_status text,
  ema_slope_direction text CHECK (ema_slope_direction IN ('UP', 'DOWN', 'FLAT')),
  trend_strength_percent numeric(5,2),

  -- Structure Info
  price_structure_tag text,
  structure_confidence text CHECK (structure_confidence IN ('HIGH', 'MODERATE', 'LOW')),

  -- Candle Pattern Analysis
  candle_pattern_name text,
  candle_pattern_direction text CHECK (candle_pattern_direction IN ('BULLISH', 'BEARISH', 'NEUTRAL')),
  candle_pattern_confidence text CHECK (candle_pattern_confidence IN ('HIGH', 'MODERATE', 'LOW')),

  -- Sentiment and Meta Score
  market_sentiment text CHECK (market_sentiment IN ('BULLISH', 'BEARISH', 'NEUTRAL')),
  sentiment_confidence numeric(5,2),
  combined_score numeric(5,2),

  -- Trade History Context
  last_signal_accurate boolean,
  last_three_outcomes jsonb DEFAULT '[]'::jsonb,

  -- Full market context (for reference)
  full_analysis jsonb DEFAULT '{}'::jsonb,

  created_at timestamptz DEFAULT now()
);

-- Create ai_prediction_accuracy table
CREATE TABLE IF NOT EXISTS ai_prediction_accuracy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  prediction_id uuid REFERENCES ai_pair_predictions(id) ON DELETE CASCADE NOT NULL,
  symbol text NOT NULL,

  -- Prediction metrics
  predicted_entry_time timestamptz NOT NULL,
  actual_entry_time timestamptz,
  prediction_error_minutes integer,
  prediction_was_accurate boolean,

  -- Indicator contribution analysis
  primary_indicators_used jsonb DEFAULT '[]'::jsonb,
  indicator_weights jsonb DEFAULT '{}'::jsonb,
  most_accurate_indicator text,

  -- Learning metrics
  conditions_at_prediction jsonb DEFAULT '{}'::jsonb,
  conditions_at_entry jsonb DEFAULT '{}'::jsonb,
  condition_drift jsonb DEFAULT '{}'::jsonb,

  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE ai_pair_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_pair_analysis_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_prediction_accuracy ENABLE ROW LEVEL SECURITY;

-- RLS Policies for ai_pair_predictions
CREATE POLICY "Users can view own predictions"
  ON ai_pair_predictions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own predictions"
  ON ai_pair_predictions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own predictions"
  ON ai_pair_predictions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own predictions"
  ON ai_pair_predictions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policies for ai_pair_analysis_snapshots
CREATE POLICY "Users can view own analysis snapshots"
  ON ai_pair_analysis_snapshots FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own analysis snapshots"
  ON ai_pair_analysis_snapshots FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own analysis snapshots"
  ON ai_pair_analysis_snapshots FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own analysis snapshots"
  ON ai_pair_analysis_snapshots FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policies for ai_prediction_accuracy
CREATE POLICY "Users can view own prediction accuracy"
  ON ai_prediction_accuracy FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own prediction accuracy"
  ON ai_prediction_accuracy FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own prediction accuracy"
  ON ai_prediction_accuracy FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_pair_predictions_user_symbol
  ON ai_pair_predictions(user_id, symbol, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pair_predictions_session
  ON ai_pair_predictions(session_id, created_at DESC)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pair_predictions_next_scan
  ON ai_pair_predictions(next_scan_scheduled_at)
  WHERE readiness_status IN ('ready', 'close');

CREATE INDEX IF NOT EXISTS idx_analysis_snapshots_prediction
  ON ai_pair_analysis_snapshots(prediction_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_prediction_accuracy_symbol
  ON ai_prediction_accuracy(user_id, symbol, created_at DESC);

-- Add helpful comments
COMMENT ON TABLE ai_pair_predictions IS 'Stores AI predictions for when pairs might reach entry conditions';
COMMENT ON TABLE ai_pair_analysis_snapshots IS 'Complete market state snapshots for each pair analysis';
COMMENT ON TABLE ai_prediction_accuracy IS 'Tracks prediction accuracy for continuous learning';
