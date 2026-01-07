/*
  # Add Duration Style Tracking System

  1. Purpose
    - Track trade style upgrades (SCALP → MICRO_INTRADAY → INTRADAY)
    - Record expected vs actual duration for learning
    - Enable analysis of style upgrade effectiveness
    - Support the new "time as scoring signal" architecture

  2. New Columns on goal_session_trades
    - `requested_style` (text): Original style requested (SCALP, MICRO_INTRADAY, INTRADAY)
    - `resolved_style` (text): Final style after auto-upgrades
    - `style_upgrade_applied` (boolean): Whether style was auto-upgraded
    - `expected_duration_hours` (numeric): Predicted duration at entry
    - `actual_duration_hours` (numeric): Actual duration (filled on close)
    - `duration_penalty_applied` (boolean): Whether extended duration penalty was applied
    - `duration_reward_applied` (boolean): Whether fast-fill reward was applied

  3. Notes
    - Style upgrades allow trades to proceed instead of blocking
    - Duration tracking enables learning system to improve predictions
    - Penalties/rewards affect confidence scoring, not execution
*/

-- Add duration tracking columns to goal_session_trades
DO $$
BEGIN
  -- Add requested_style column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'requested_style'
  ) THEN
    ALTER TABLE goal_session_trades 
    ADD COLUMN requested_style text DEFAULT 'INTRADAY';
  END IF;

  -- Add resolved_style column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'resolved_style'
  ) THEN
    ALTER TABLE goal_session_trades 
    ADD COLUMN resolved_style text DEFAULT 'INTRADAY';
  END IF;

  -- Add style_upgrade_applied column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'style_upgrade_applied'
  ) THEN
    ALTER TABLE goal_session_trades 
    ADD COLUMN style_upgrade_applied boolean DEFAULT false;
  END IF;

  -- Add expected_duration_hours column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'expected_duration_hours'
  ) THEN
    ALTER TABLE goal_session_trades 
    ADD COLUMN expected_duration_hours numeric(6,2);
  END IF;

  -- Add actual_duration_hours column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'actual_duration_hours'
  ) THEN
    ALTER TABLE goal_session_trades 
    ADD COLUMN actual_duration_hours numeric(6,2);
  END IF;

  -- Add duration_penalty_applied column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'duration_penalty_applied'
  ) THEN
    ALTER TABLE goal_session_trades 
    ADD COLUMN duration_penalty_applied boolean DEFAULT false;
  END IF;

  -- Add duration_reward_applied column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'duration_reward_applied'
  ) THEN
    ALTER TABLE goal_session_trades 
    ADD COLUMN duration_reward_applied boolean DEFAULT false;
  END IF;
END $$;

-- Add index for style analysis queries
CREATE INDEX IF NOT EXISTS idx_goal_session_trades_style_tracking 
ON goal_session_trades(user_id, resolved_style, style_upgrade_applied) 
WHERE status = 'closed';

-- Add index for duration analysis
CREATE INDEX IF NOT EXISTS idx_goal_session_trades_duration_analysis
ON goal_session_trades(user_id, expected_duration_hours, actual_duration_hours)
WHERE status = 'closed' AND actual_duration_hours IS NOT NULL;

-- Create function to calculate actual duration on trade close
CREATE OR REPLACE FUNCTION update_actual_duration_on_close()
RETURNS TRIGGER AS $$
BEGIN
  -- Only update when status changes to 'closed'
  IF NEW.status = 'closed' AND OLD.status != 'closed' THEN
    -- Calculate actual duration in hours
    IF NEW.opened_at IS NOT NULL AND NEW.closed_at IS NOT NULL THEN
      NEW.actual_duration_hours := EXTRACT(EPOCH FROM (NEW.closed_at - NEW.opened_at)) / 3600.0;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic duration calculation
DROP TRIGGER IF EXISTS trigger_update_actual_duration ON goal_session_trades;
CREATE TRIGGER trigger_update_actual_duration
  BEFORE UPDATE ON goal_session_trades
  FOR EACH ROW
  EXECUTE FUNCTION update_actual_duration_on_close();

-- Add comment explaining the style tracking system
COMMENT ON COLUMN goal_session_trades.requested_style IS 'Original trade style before auto-upgrades (SCALP, MICRO_INTRADAY, INTRADAY)';
COMMENT ON COLUMN goal_session_trades.resolved_style IS 'Final trade style after auto-upgrades';
COMMENT ON COLUMN goal_session_trades.style_upgrade_applied IS 'Whether style was auto-upgraded due to duration expectations';
COMMENT ON COLUMN goal_session_trades.expected_duration_hours IS 'Predicted duration at trade entry';
COMMENT ON COLUMN goal_session_trades.actual_duration_hours IS 'Actual duration (auto-calculated on close)';
COMMENT ON COLUMN goal_session_trades.duration_penalty_applied IS 'Whether extended duration confidence penalty was applied';
COMMENT ON COLUMN goal_session_trades.duration_reward_applied IS 'Whether fast-fill confidence reward was applied';
