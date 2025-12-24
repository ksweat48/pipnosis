/*
  # Add Goal Intelligence Classification System

  1. New Columns for goal_sessions table
    - `goal_mode` (text) - Classification: precision, execution, campaign, growth
    - `goal_ratio_percent` (numeric) - Goal amount as percentage of account balance
    - `mode_overridden` (boolean) - Flag for admin manual overrides
    - `goal_efficient_risk_pct` (numeric) - Capital-efficient risk calculation
    - `execution_psychology` (text) - Mode-specific execution mindset

  2. New Table
    - `goal_feasibility_checks` - Audit trail for all goal classifications

  3. Security
    - Enable RLS on goal_feasibility_checks
    - Users can only read their own feasibility checks
    - Service role can write feasibility checks

  4. Notes
    - This implements the elite Goal-Intelligence Layer
    - Transforms Alpha from risk-aware bot to intelligent capital manager
    - Goals are classified BEFORE trade planning begins
*/

-- Add goal intelligence columns to goal_sessions
DO $$
BEGIN
  -- goal_mode: Classification of goal (precision/execution/campaign/growth)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'goal_mode'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN goal_mode TEXT;
    COMMENT ON COLUMN goal_sessions.goal_mode IS 'Goal classification: precision (≤2%), execution (2-10%), campaign (10-30%), growth (>30%)';
  END IF;

  -- goal_ratio_percent: Goal as percentage of balance
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'goal_ratio_percent'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN goal_ratio_percent NUMERIC DEFAULT 0;
    COMMENT ON COLUMN goal_sessions.goal_ratio_percent IS 'Goal amount / account balance * 100';
  END IF;

  -- mode_overridden: Admin override flag
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'mode_overridden'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN mode_overridden BOOLEAN DEFAULT FALSE;
    COMMENT ON COLUMN goal_sessions.mode_overridden IS 'True if admin manually overrode goal classification';
  END IF;

  -- goal_efficient_risk_pct: Capital-efficient risk calculation
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'goal_efficient_risk_pct'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN goal_efficient_risk_pct NUMERIC;
    COMMENT ON COLUMN goal_sessions.goal_efficient_risk_pct IS 'Goal-scaled risk % (prevents ego trading on small goals)';
  END IF;

  -- execution_psychology: Mode-specific mindset
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'execution_psychology'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN execution_psychology TEXT;
    COMMENT ON COLUMN goal_sessions.execution_psychology IS 'surgical, disciplined, patient, or blocked';
  END IF;
END $$;

-- Create goal_feasibility_checks table for audit trail
CREATE TABLE IF NOT EXISTS goal_feasibility_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_session_id UUID REFERENCES goal_sessions(id) ON DELETE CASCADE,

  -- Goal context
  goal_amount NUMERIC NOT NULL,
  account_balance NUMERIC NOT NULL,
  goal_ratio_percent NUMERIC NOT NULL,

  -- Classification result
  goal_mode TEXT NOT NULL,
  is_feasible BOOLEAN NOT NULL,
  should_block_execution BOOLEAN NOT NULL,
  reasoning TEXT NOT NULL,

  -- Mode-specific parameters
  max_risk_per_trade_pct NUMERIC NOT NULL,
  expected_trade_count INTEGER NOT NULL,
  target_rr_min NUMERIC NOT NULL,
  target_rr_max NUMERIC NOT NULL,
  min_confidence_threshold NUMERIC NOT NULL,
  execution_psychology TEXT NOT NULL,

  -- Alternative approach (for blocked goals)
  alternative_staged_targets JSONB,
  alternative_timeframe TEXT,
  alternative_reasoning TEXT,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  user_message TEXT
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_feasibility_checks_user
  ON goal_feasibility_checks(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_feasibility_checks_session
  ON goal_feasibility_checks(goal_session_id);

CREATE INDEX IF NOT EXISTS idx_feasibility_checks_mode
  ON goal_feasibility_checks(goal_mode);

-- Enable RLS
ALTER TABLE goal_feasibility_checks ENABLE ROW LEVEL SECURITY;

-- RLS Policies for goal_feasibility_checks
CREATE POLICY "Users can read own feasibility checks"
  ON goal_feasibility_checks
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert feasibility checks"
  ON goal_feasibility_checks
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Add constraint to ensure valid goal modes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'goal_sessions_goal_mode_check'
  ) THEN
    ALTER TABLE goal_sessions
      ADD CONSTRAINT goal_sessions_goal_mode_check
      CHECK (goal_mode IN ('precision', 'execution', 'campaign', 'growth') OR goal_mode IS NULL);
  END IF;
END $$;

-- Add constraint for execution psychology
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'goal_sessions_execution_psychology_check'
  ) THEN
    ALTER TABLE goal_sessions
      ADD CONSTRAINT goal_sessions_execution_psychology_check
      CHECK (execution_psychology IN ('surgical', 'disciplined', 'patient', 'blocked') OR execution_psychology IS NULL);
  END IF;
END $$;

-- Create function to auto-populate goal_ratio_percent on insert/update
CREATE OR REPLACE FUNCTION calculate_goal_ratio()
RETURNS TRIGGER AS $$
BEGIN
  -- Calculate goal ratio if target_value and balance are present
  IF NEW.target_value IS NOT NULL AND NEW.target_value > 0 THEN
    -- Try to get balance from user_balance table
    DECLARE
      user_balance NUMERIC;
    BEGIN
      SELECT current_balance INTO user_balance
      FROM user_balance
      WHERE user_id = NEW.user_id
      LIMIT 1;

      IF user_balance IS NOT NULL AND user_balance > 0 THEN
        NEW.goal_ratio_percent := (NEW.target_value / user_balance) * 100;
      END IF;
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to auto-calculate goal ratio
DROP TRIGGER IF EXISTS trigger_calculate_goal_ratio ON goal_sessions;
CREATE TRIGGER trigger_calculate_goal_ratio
  BEFORE INSERT OR UPDATE OF target_value
  ON goal_sessions
  FOR EACH ROW
  EXECUTE FUNCTION calculate_goal_ratio();

COMMENT ON TABLE goal_feasibility_checks IS 'Audit trail for Goal Intelligence classification decisions';
COMMENT ON FUNCTION calculate_goal_ratio() IS 'Auto-calculate goal ratio percentage for classification';
