/*
  # Add AI Learning Columns to goal_session_trades

  ## Changes
  - Add `ai_validated` BOOLEAN DEFAULT false - Tracks if AI has analyzed this trade
  - Add `confidence_score` NUMERIC DEFAULT 75 - AI confidence in the trade decision
  - Add `market_conditions` JSONB DEFAULT '{}'::jsonb - Market state at trade time
  - Add `setup_type` TEXT DEFAULT 'Unknown' - Type of setup identified

  ## Purpose
  These columns enable the AI learning system to:
  - Track which trades have been analyzed
  - Store confidence scores for calibration
  - Record market conditions for pattern matching
  - Classify setup types for strategy discovery

  ## Indexes
  - Index on (user_id, closed_at DESC) WHERE ai_validated = false
    Enables fast queries for unvalidated closed trades
*/

-- Add AI learning columns to goal_session_trades
ALTER TABLE goal_session_trades
ADD COLUMN IF NOT EXISTS ai_validated BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS market_conditions JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS setup_type TEXT DEFAULT 'Unknown';

-- Note: confidence_score may already exist, add only if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'confidence_score'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN confidence_score NUMERIC DEFAULT 75;
  END IF;
END $$;

-- Create index for AI learning queries
CREATE INDEX IF NOT EXISTS idx_goal_trades_ai_validation
  ON goal_session_trades(user_id, closed_at DESC)
  WHERE status = 'closed' AND ai_validated = false;

-- Create index for setup type analysis
CREATE INDEX IF NOT EXISTS idx_goal_trades_setup_type
  ON goal_session_trades(user_id, setup_type)
  WHERE status = 'closed';
