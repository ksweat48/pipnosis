/*
  # Goal Feasibility Tracking System

  Creates table to track goal downshift decisions for analytics and Alpha learning.

  1. New Table
    - `goal_feasibility_tracking`
      - Tracks when goals are adjusted due to market constraints
      - Records Alpha's affirmation/rejection decisions
      - Stores market context for ML analysis

  2. Security
    - Enable RLS
    - Users can only read their own tracking data
    - System can insert on behalf of users
*/

-- Create goal feasibility tracking table
CREATE TABLE IF NOT EXISTS goal_feasibility_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES goal_sessions(id) ON DELETE CASCADE,
  trade_id uuid REFERENCES goal_session_trades(id) ON DELETE SET NULL,

  -- Feasibility decision details
  original_goal numeric NOT NULL,
  adjusted_goal numeric NOT NULL,
  retention_percent numeric NOT NULL CHECK (retention_percent >= 0 AND retention_percent <= 1),
  reasons_for_downshift text[] NOT NULL,

  -- Alpha's decision
  alpha_affirmed boolean NOT NULL DEFAULT false,
  alpha_reasoning text,

  -- Market context at time of decision
  market_context jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Outcome tracking (filled in after trade closes)
  actual_profit numeric,
  goal_achieved boolean,

  created_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_goal_feasibility_tracking_user_id
  ON goal_feasibility_tracking(user_id);
CREATE INDEX IF NOT EXISTS idx_goal_feasibility_tracking_session_id
  ON goal_feasibility_tracking(session_id);
CREATE INDEX IF NOT EXISTS idx_goal_feasibility_tracking_trade_id
  ON goal_feasibility_tracking(trade_id);
CREATE INDEX IF NOT EXISTS idx_goal_feasibility_tracking_created_at
  ON goal_feasibility_tracking(created_at DESC);

-- Enable RLS
ALTER TABLE goal_feasibility_tracking ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own feasibility tracking"
  ON goal_feasibility_tracking
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "System can insert feasibility tracking"
  ON goal_feasibility_tracking
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "System can update feasibility tracking outcomes"
  ON goal_feasibility_tracking
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON goal_feasibility_tracking TO authenticated;
GRANT SELECT, INSERT, UPDATE ON goal_feasibility_tracking TO service_role;