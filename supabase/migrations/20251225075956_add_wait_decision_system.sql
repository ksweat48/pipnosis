/*
  # Add WAIT Decision System

  ## Overview
  This migration implements the WAIT vs NO_TRADE distinction for Alpha decision-making.
  
  **WAIT** = Edge detected but timing wrong (pullback needed, zone not hit, etc.)
  **NO_TRADE** = No edge detected or conditions unfavorable
  
  ## Changes
  
  1. **New Table: wait_conditions**
     - Tracks all WAIT decisions with target zones and invalidation levels
     - Links to sessions and eventual trade execution
     - Enables performance analytics on WAIT→EXECUTE conversion
  
  2. **Enhanced Fields:**
     - `target_entry_zone_min`: Lower bound of ideal entry zone
     - `target_entry_zone_max`: Upper bound of ideal entry zone
     - `invalidation_price`: Price level where setup becomes invalid
     - `wait_reasoning`: Alpha's explanation for waiting
     - `resolution_type`: How the WAIT resolved (executed, invalidated, timeout)
  
  3. **Security:**
     - RLS enabled for all users
     - Users can only view/modify their own WAIT conditions
  
  ## Analytics Benefits
  - Track WAIT→EXECUTE success rate
  - Measure confidence band performance
  - Identify optimal entry timing patterns
  - Calculate edge frequency curves
*/

-- Create wait_conditions table
CREATE TABLE IF NOT EXISTS wait_conditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid REFERENCES goal_sessions(id) ON DELETE CASCADE,
  
  -- Market context
  symbol text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('BUY', 'SELL')),
  current_price numeric NOT NULL,
  
  -- Wait parameters
  target_entry_zone_min numeric NOT NULL,
  target_entry_zone_max numeric NOT NULL,
  invalidation_price numeric NOT NULL,
  
  -- Decision context
  confidence integer NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
  wait_reasoning text NOT NULL,
  alpha_decision_snapshot jsonb,
  
  -- Omega vote context (for later analysis)
  omega_votes jsonb,
  
  -- Resolution tracking
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'invalidated', 'timeout')),
  resolution_type text CHECK (resolution_type IN ('executed', 'invalidated', 'timeout', 'manual_cancel')),
  resolved_at timestamptz,
  resulting_trade_id uuid,
  
  -- Performance tracking
  entry_quality_score integer CHECK (entry_quality_score >= 0 AND entry_quality_score <= 100),
  wait_duration_minutes integer,
  price_movement_pips numeric,
  
  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_wait_conditions_user_id ON wait_conditions(user_id);
CREATE INDEX IF NOT EXISTS idx_wait_conditions_session_id ON wait_conditions(session_id);
CREATE INDEX IF NOT EXISTS idx_wait_conditions_status ON wait_conditions(status);
CREATE INDEX IF NOT EXISTS idx_wait_conditions_created_at ON wait_conditions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wait_conditions_symbol ON wait_conditions(symbol);

-- Enable RLS
ALTER TABLE wait_conditions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own wait conditions"
  ON wait_conditions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own wait conditions"
  ON wait_conditions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own wait conditions"
  ON wait_conditions
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own wait conditions"
  ON wait_conditions
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Function to calculate WAIT performance metrics
CREATE OR REPLACE FUNCTION calculate_wait_performance(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result jsonb;
  v_total_waits integer;
  v_executed_count integer;
  v_invalidated_count integer;
  v_timeout_count integer;
  v_avg_wait_duration numeric;
  v_success_rate numeric;
BEGIN
  -- Get counts
  SELECT 
    COUNT(*) FILTER (WHERE status = 'resolved'),
    COUNT(*) FILTER (WHERE resolution_type = 'executed'),
    COUNT(*) FILTER (WHERE resolution_type = 'invalidated'),
    COUNT(*) FILTER (WHERE resolution_type = 'timeout')
  INTO
    v_total_waits,
    v_executed_count,
    v_invalidated_count,
    v_timeout_count
  FROM wait_conditions
  WHERE user_id = p_user_id;
  
  -- Calculate average wait duration
  SELECT AVG(wait_duration_minutes)
  INTO v_avg_wait_duration
  FROM wait_conditions
  WHERE user_id = p_user_id
    AND resolution_type = 'executed';
  
  -- Calculate success rate (executed / total resolved)
  IF v_total_waits > 0 THEN
    v_success_rate := (v_executed_count::numeric / v_total_waits) * 100;
  ELSE
    v_success_rate := 0;
  END IF;
  
  -- Build result
  v_result := jsonb_build_object(
    'total_waits', COALESCE(v_total_waits, 0),
    'executed', COALESCE(v_executed_count, 0),
    'invalidated', COALESCE(v_invalidated_count, 0),
    'timeout', COALESCE(v_timeout_count, 0),
    'avg_wait_duration_minutes', COALESCE(v_avg_wait_duration, 0),
    'success_rate', COALESCE(v_success_rate, 0)
  );
  
  RETURN v_result;
END;
$$;

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_wait_conditions_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_wait_conditions_updated_at_trigger
  BEFORE UPDATE ON wait_conditions
  FOR EACH ROW
  EXECUTE FUNCTION update_wait_conditions_updated_at();

-- Add WAIT to alpha_brain_decisions table if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'alpha_brain_decisions') THEN
    -- Drop existing constraint if it exists
    ALTER TABLE alpha_brain_decisions DROP CONSTRAINT IF EXISTS alpha_brain_decisions_action_check;
    
    -- Add new constraint with WAIT
    ALTER TABLE alpha_brain_decisions ADD CONSTRAINT alpha_brain_decisions_action_check 
      CHECK (action IN ('BUY', 'SELL', 'NO_TRADE', 'WAIT'));
  END IF;
END $$;

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON wait_conditions TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_wait_performance(uuid) TO authenticated;
