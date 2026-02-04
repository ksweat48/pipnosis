/*
  # Create Trade Thesis Plans System

  ## Overview
  
  Implements SSOT for trade thesis management. Each trade has ONE complete thesis plan that serves
  as the single source of truth for all mid-trade evaluation decisions.
  
  ## Tables Created
  
  1. trade_thesis_plans
     - Stores Alpha's complete thesis for each trade
     - Immutable once created (captured at entry)
     - Contains invalidation conditions, confirmation levels, key watchers
     - SSOT: Only created once per trade, referenced everywhere
  
  2. thesis_monitoring_logs
     - Audit trail of thesis condition evaluations
     - Immutable insert-only design
     - Tracks when conditions are met/violated
     - Documents thesis status changes with reasoning
  
  3. Updates to goal_session_trades
     - thesis_plan_id: Links to thesis plan
     - thesis_status: Current state (intact, weakening, broken, etc.)
     - thesis_confidence_current: Eroding confidence tracking
     - last_thesis_evaluation_at: Freshness check for monitoring
  
  ## SSOT Principles
  
  - Thesis plan created exactly once per trade
  - All monitoring logic references this single source
  - No thesis logic duplicated across services
  - Immutable creation date ensures thesis snapshot consistency
  
  ## Security
  
  - RLS: Users can only view own trades' thesis plans
  - Service role: Can update thesis status during monitoring
  - Audit trail: All changes logged with timestamps
*/

-- Create trade_thesis_plans table (immutable thesis storage)
CREATE TABLE IF NOT EXISTS trade_thesis_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_session_id uuid NOT NULL REFERENCES goal_sessions(id) ON DELETE CASCADE,
  trade_id uuid NOT NULL REFERENCES goal_session_trades(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('buy', 'sell')),
  
  -- Core thesis narrative
  thesis_narrative text NOT NULL,
  regime_snapshot jsonb,
  setup_type text CHECK (setup_type IN ('momentum', 'reversal', 'structure_break', 'continuation', 'breakout', 'pullback')),
  
  -- Invalidation conditions (CRITICAL: These break the thesis)
  invalidation_conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Format: [
  --   {"condition": "price_breaks_below", "level": 1.0950, "reason": "support_failure"},
  --   {"condition": "closes_outside_range", "level_min": 1.0945, "level_max": 1.0970, "reason": "range_break"}
  -- ]
  
  -- Confirmation conditions (These validate the thesis)
  confirmation_conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Format: [
  --   {"condition": "holds_above_level", "level": 1.0945, "duration_minutes": 30},
  --   {"condition": "momentum_direction", "direction": "up", "via_indicator": "ema_above_price"}
  -- ]
  
  -- Key price levels to watch
  key_levels jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Format: [
  --   {"price": 1.0950, "type": "support", "significance": "primary", "description": "First support"},
  --   {"price": 1.1000, "type": "resistance", "significance": "secondary", "description": "Round level"}
  -- ]
  
  -- Expected behavior timeline
  expected_duration_minutes integer,
  expected_direction text CHECK (expected_direction IN ('up', 'down', 'range-bound')),
  expected_volatility text CHECK (expected_volatility IN ('low', 'medium', 'high')),
  
  -- Thesis confidence and scoring
  alpha_confidence_at_entry numeric(4, 2) CHECK (alpha_confidence_at_entry >= 0 AND alpha_confidence_at_entry <= 1),
  confidence_band_upper numeric(4, 2) CHECK (confidence_band_upper >= 0 AND confidence_band_upper <= 1),
  confidence_band_lower numeric(4, 2) CHECK (confidence_band_lower >= 0 AND confidence_band_lower <= 1),
  
  -- Risk metrics at entry
  thesis_risk_reward numeric(6, 2),
  thesis_expected_holding_time_minutes integer,
  
  -- Metadata
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  CONSTRAINT valid_thesis_narrative CHECK (LENGTH(thesis_narrative) > 0),
  CONSTRAINT valid_levels CHECK (JSONB_ARRAY_LENGTH(key_levels) >= 0),
  CONSTRAINT valid_conditions CHECK (JSONB_ARRAY_LENGTH(invalidation_conditions) >= 0 AND JSONB_ARRAY_LENGTH(confirmation_conditions) >= 0),
  CONSTRAINT unique_trade_thesis UNIQUE (trade_id)
);

-- Create thesis_monitoring_logs table (immutable audit trail)
CREATE TABLE IF NOT EXISTS thesis_monitoring_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trade_id uuid NOT NULL REFERENCES goal_session_trades(id) ON DELETE CASCADE,
  thesis_plan_id uuid NOT NULL REFERENCES trade_thesis_plans(id) ON DELETE CASCADE,
  
  -- Condition evaluation
  condition_type text NOT NULL CHECK (condition_type IN ('invalidation', 'confirmation', 'key_level', 'momentum', 'time_decay')),
  condition_description text NOT NULL,
  condition_status text NOT NULL CHECK (condition_status IN ('met', 'violated', 'triggered', 'cleared', 'monitored')),
  
  -- Context at time of check
  current_price numeric(18, 8) NOT NULL,
  market_spread numeric(18, 8),
  
  -- Thesis status impact
  thesis_status_before text,
  thesis_status_after text,
  confidence_change numeric(4, 2),
  
  -- Reasoning and metadata
  reasoning text,
  metadata jsonb,
  
  -- Timestamps
  evaluated_at timestamptz DEFAULT now(),
  
  CONSTRAINT confidence_in_range CHECK (confidence_change >= -1 AND confidence_change <= 1)
);

-- Add thesis columns to goal_session_trades
ALTER TABLE goal_session_trades ADD COLUMN IF NOT EXISTS thesis_plan_id uuid REFERENCES trade_thesis_plans(id);
ALTER TABLE goal_session_trades ADD COLUMN IF NOT EXISTS thesis_status text DEFAULT 'new' CHECK (thesis_status IN ('new', 'intact', 'strengthening', 'deteriorating', 'partially_valid', 'broken', 'momentum_loss'));
ALTER TABLE goal_session_trades ADD COLUMN IF NOT EXISTS thesis_confidence_current numeric(4, 2) DEFAULT 0.5;
ALTER TABLE goal_session_trades ADD COLUMN IF NOT EXISTS last_thesis_evaluation_at timestamptz;

-- Enable RLS
ALTER TABLE trade_thesis_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE thesis_monitoring_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for trade_thesis_plans
CREATE POLICY "Users view own thesis plans"
  ON trade_thesis_plans FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert thesis plans for own trades"
  ON trade_thesis_plans FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role can read all thesis plans"
  ON trade_thesis_plans FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "Service role can update thesis status"
  ON trade_thesis_plans FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- RLS Policies for thesis_monitoring_logs
CREATE POLICY "Users view own thesis logs"
  ON thesis_monitoring_logs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role logs thesis events"
  ON thesis_monitoring_logs FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Indexes for performance
CREATE INDEX idx_thesis_plans_trade_id ON trade_thesis_plans(trade_id);
CREATE INDEX idx_thesis_plans_user_id ON trade_thesis_plans(user_id);
CREATE INDEX idx_thesis_plans_session_id ON trade_thesis_plans(goal_session_id);
CREATE INDEX idx_thesis_logs_trade_id ON thesis_monitoring_logs(trade_id);
CREATE INDEX idx_thesis_logs_evaluated_at ON thesis_monitoring_logs(evaluated_at DESC);

-- Update timestamps
CREATE OR REPLACE FUNCTION update_thesis_plans_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER thesis_plans_timestamp
  BEFORE UPDATE ON trade_thesis_plans
  FOR EACH ROW
  EXECUTE FUNCTION update_thesis_plans_timestamp();

COMMENT ON TABLE trade_thesis_plans IS 'SSOT for trade thesis information. Created once per trade, immutable after creation. All monitoring logic references this single source.';
COMMENT ON TABLE thesis_monitoring_logs IS 'Immutable audit trail of thesis condition evaluations. Records when conditions are met/violated and thesis status changes.';
