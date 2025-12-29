/*
  # Add Position Size Multipliers and Update Confidence Thresholds

  ## Overview
  This migration implements a refined risk management system with:
  1. Position size multipliers based on risk mode (0.8x, 1.0x, 1.2x)
  2. Updated confidence thresholds (60%, 65%, 70%)
  3. Omega consensus advisory tracking

  ## Changes

  ### 1. New Columns
  - `goal_sessions.position_size_multiplier` - Tracks the multiplier applied (numeric)
  - `goal_sessions.min_confidence_threshold` - Records the confidence threshold used (integer)
  - `goal_sessions.recommended_consensus_count` - Advisory Omega consensus count (integer)
  - `goal_sessions.consensus_strength_modifier` - Confidence adjustment based on consensus (numeric)

  ### 2. Risk Mode Values
  Position Size Multipliers:
  - LOW: 0.8x (conservative, smaller positions)
  - MEDIUM: 1.0x (balanced, standard sizing)
  - HIGH: 1.2x (aggressive, larger positions)

  Confidence Thresholds:
  - LOW: 70% (very selective)
  - MEDIUM: 65% (balanced)
  - HIGH: 60% (aggressive)

  Omega Consensus Advisory:
  - LOW: 5/7 Omegas (71% consensus)
  - MEDIUM: 4/7 Omegas (57% consensus)
  - HIGH: 3/7 Omegas (43% consensus)

  ## Notes
  - These columns are nullable to maintain backward compatibility
  - Default values are calculated at runtime based on risk_mode
  - Position size multiplier is applied AFTER base risk calculation
  - Consensus strength modifier can boost/reduce confidence by ±10%
*/

-- Add position_size_multiplier column to goal_sessions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'position_size_multiplier'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN position_size_multiplier numeric(3,2) DEFAULT 1.0;
    COMMENT ON COLUMN goal_sessions.position_size_multiplier IS 'Position size multiplier applied based on risk mode (0.8x low, 1.0x medium, 1.2x high)';
  END IF;
END $$;

-- Add min_confidence_threshold column to goal_sessions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'min_confidence_threshold'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN min_confidence_threshold integer;
    COMMENT ON COLUMN goal_sessions.min_confidence_threshold IS 'Minimum confidence threshold used for this session (60/65/70 based on risk mode)';
  END IF;
END $$;

-- Add recommended_consensus_count column to goal_sessions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'recommended_consensus_count'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN recommended_consensus_count integer;
    COMMENT ON COLUMN goal_sessions.recommended_consensus_count IS 'Advisory minimum Omega consensus count (3/4/5 based on risk mode)';
  END IF;
END $$;

-- Add consensus_strength_modifier column to goal_sessions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'consensus_strength_modifier'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN consensus_strength_modifier numeric(4,3);
    COMMENT ON COLUMN goal_sessions.consensus_strength_modifier IS 'Confidence adjustment based on consensus strength (-0.09 to +0.10)';
  END IF;
END $$;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_goal_sessions_risk_mode ON goal_sessions(risk_mode);
CREATE INDEX IF NOT EXISTS idx_goal_sessions_position_multiplier ON goal_sessions(position_size_multiplier);

-- Update RLS policies (already exist, no changes needed)
-- The existing policies on goal_sessions will automatically cover these new columns
