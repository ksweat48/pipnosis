/*
  # Create Goal Feasibility Tracking System

  1. New Tables
    - `goal_feasibility_decisions`
      - Tracks every feasibility analysis and Alpha's decision
      - Records original vs adjusted goals
      - Captures meaningfulness checks and thresholds
      - Links to goal sessions and eventual trades

  2. Purpose
    - Analytics: Understand when downshifts happen
    - Learning: Track Alpha's decision quality
    - Transparency: Audit trail for goal adjustments
    - Performance: Measure downshift success rates

  3. Security
    - Enable RLS
    - Users can only see their own decisions
*/

-- Create goal feasibility decisions table
CREATE TABLE IF NOT EXISTS goal_feasibility_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid REFERENCES goal_sessions(id) ON DELETE SET NULL,

  -- Original goal request
  original_goal numeric NOT NULL,
  current_progress numeric NOT NULL DEFAULT 0,
  remaining_goal numeric NOT NULL,

  -- Adjusted proposal
  adjusted_goal numeric NOT NULL,
  retention_percent numeric NOT NULL,

  -- Market context
  symbol text NOT NULL,
  account_balance numeric NOT NULL,
  current_atr numeric NOT NULL,
  typical_atr numeric NOT NULL,
  daily_atr numeric NOT NULL,
  current_spread numeric NOT NULL,
  session_liquidity text NOT NULL CHECK (session_liquidity IN ('high', 'medium', 'low')),
  atr_multiplier_from_typical numeric NOT NULL,

  -- Adjusted trade parameters
  adjusted_target_profit numeric NOT NULL,
  adjusted_stop_loss numeric NOT NULL,
  adjusted_risk_reward numeric NOT NULL,
  adjusted_time_to_fill_minutes integer NOT NULL,
  adjusted_position_size numeric NOT NULL,
  estimated_spread_cost numeric NOT NULL,

  -- Meaningfulness checks
  meets_volatility_floor boolean NOT NULL,
  meets_account_floor boolean NOT NULL,
  meets_spread_floor boolean NOT NULL,
  meets_historical_floor boolean NOT NULL,
  any_threshold_met boolean NOT NULL,

  -- Threshold values used
  volatility_floor_value numeric NOT NULL,
  account_floor_value numeric NOT NULL,
  spread_floor_value numeric NOT NULL,
  historical_floor_value numeric NOT NULL,

  -- Feasibility result
  feasibility_tier text NOT NULL CHECK (feasibility_tier IN ('EXECUTE', 'WAIT_FOR_VOLATILITY', 'BLOCK_WITH_ALTERNATIVES')),
  wait_reason text,
  block_reason text,

  -- Alpha's decision (if applicable)
  alpha_decision text CHECK (alpha_decision IN ('AFFIRM', 'WAIT', 'REJECT')),
  alpha_reasoning text,
  alpha_adjustments jsonb,

  -- Outcome tracking (filled in later)
  trade_id uuid REFERENCES goal_session_trades(id) ON DELETE SET NULL,
  executed boolean NOT NULL DEFAULT false,
  actual_profit numeric,
  outcome_classification text CHECK (outcome_classification IN ('success', 'failure', 'pending')),

  -- Metadata
  reasons_for_downshift text[],
  calculation_metadata jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  evaluated_at timestamptz,
  outcome_recorded_at timestamptz
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_goal_feasibility_decisions_user_id
  ON goal_feasibility_decisions(user_id);

CREATE INDEX IF NOT EXISTS idx_goal_feasibility_decisions_session_id
  ON goal_feasibility_decisions(session_id);

CREATE INDEX IF NOT EXISTS idx_goal_feasibility_decisions_created_at
  ON goal_feasibility_decisions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_goal_feasibility_decisions_symbol
  ON goal_feasibility_decisions(symbol);

CREATE INDEX IF NOT EXISTS idx_goal_feasibility_decisions_tier
  ON goal_feasibility_decisions(feasibility_tier);

CREATE INDEX IF NOT EXISTS idx_goal_feasibility_decisions_alpha_decision
  ON goal_feasibility_decisions(alpha_decision);

CREATE INDEX IF NOT EXISTS idx_goal_feasibility_decisions_outcome
  ON goal_feasibility_decisions(outcome_classification);

-- Enable RLS
ALTER TABLE goal_feasibility_decisions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own feasibility decisions"
  ON goal_feasibility_decisions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own feasibility decisions"
  ON goal_feasibility_decisions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own feasibility decisions"
  ON goal_feasibility_decisions
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Function to get feasibility analytics for a user
CREATE OR REPLACE FUNCTION get_user_feasibility_analytics(target_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_decisions', COUNT(*),
    'execute_count', COUNT(*) FILTER (WHERE feasibility_tier = 'EXECUTE'),
    'wait_count', COUNT(*) FILTER (WHERE feasibility_tier = 'WAIT_FOR_VOLATILITY'),
    'block_count', COUNT(*) FILTER (WHERE feasibility_tier = 'BLOCK_WITH_ALTERNATIVES'),
    'alpha_affirm_count', COUNT(*) FILTER (WHERE alpha_decision = 'AFFIRM'),
    'alpha_wait_count', COUNT(*) FILTER (WHERE alpha_decision = 'WAIT'),
    'alpha_reject_count', COUNT(*) FILTER (WHERE alpha_decision = 'REJECT'),
    'avg_retention_percent', AVG(retention_percent),
    'avg_adjusted_goal', AVG(adjusted_goal),
    'executed_count', COUNT(*) FILTER (WHERE executed = true),
    'success_rate',
      CASE
        WHEN COUNT(*) FILTER (WHERE outcome_classification IS NOT NULL) > 0
        THEN (COUNT(*) FILTER (WHERE outcome_classification = 'success')::float /
              COUNT(*) FILTER (WHERE outcome_classification IS NOT NULL)::float)
        ELSE 0
      END,
    'meaningfulness_pass_rate',
      CASE
        WHEN COUNT(*) > 0
        THEN (COUNT(*) FILTER (WHERE any_threshold_met = true)::float / COUNT(*)::float)
        ELSE 0
      END
  )
  INTO result
  FROM goal_feasibility_decisions
  WHERE user_id = target_user_id;

  RETURN result;
END;
$$;

-- Function to get recent feasibility decisions
CREATE OR REPLACE FUNCTION get_recent_feasibility_decisions(
  target_user_id uuid,
  limit_count integer DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  symbol text,
  original_goal numeric,
  adjusted_goal numeric,
  retention_percent numeric,
  feasibility_tier text,
  alpha_decision text,
  alpha_reasoning text,
  executed boolean,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    gfd.id,
    gfd.symbol,
    gfd.original_goal,
    gfd.adjusted_goal,
    gfd.retention_percent,
    gfd.feasibility_tier,
    gfd.alpha_decision,
    gfd.alpha_reasoning,
    gfd.executed,
    gfd.created_at
  FROM goal_feasibility_decisions gfd
  WHERE gfd.user_id = target_user_id
  ORDER BY gfd.created_at DESC
  LIMIT limit_count;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_user_feasibility_analytics(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_recent_feasibility_decisions(uuid, integer) TO authenticated;