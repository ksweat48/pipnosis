/*
  # Add New Confidence Tiers to Database Constraints

  CCIP-2026-0425B: 4-Tier Confidence Simplification

  ## Changes
  - Adds the 3 new active tiers to the confidence_tier CHECK constraint on both tables:
    - very_confident
    - extremely_confident
    (no_read and confident already exist in both constraints)
  - Does NOT remove old tiers — historical records remain valid for display
  - Tables affected: goal_session_trades, alpha_decisions

  ## New Active Tiers
  - no_read: Answer sheet genuinely blank — NO_TRADE only
  - confident: Solid structure, direction named, execute now or wait intent
  - very_confident: Strong evidence stack, execute now or wait intent
  - extremely_confident: Near-perfect alignment, execute now only

  ## Legacy Tiers (retained for historical records)
  - low, cautious, moderate, high, very_high, extreme

  ## Security
  - No RLS changes — only CHECK constraint updates
*/

-- Update confidence_tier constraint on goal_session_trades
DO $$
BEGIN
  -- Drop the old constraint if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'goal_session_trades'
      AND constraint_name = 'goal_session_trades_confidence_tier_check'
  ) THEN
    ALTER TABLE goal_session_trades DROP CONSTRAINT goal_session_trades_confidence_tier_check;
  END IF;

  -- Add updated constraint with all valid tiers (old + new)
  ALTER TABLE goal_session_trades
    ADD CONSTRAINT goal_session_trades_confidence_tier_check
    CHECK (confidence_tier IN (
      'no_read', 'low', 'cautious', 'moderate', 'confident', 'high', 'very_high', 'extreme',
      'very_confident', 'extremely_confident'
    ));
END $$;

-- Update confidence_tier constraint on alpha_decisions
DO $$
BEGIN
  -- Drop the old constraint if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'alpha_decisions'
      AND constraint_name = 'alpha_decisions_confidence_tier_check'
  ) THEN
    ALTER TABLE alpha_decisions DROP CONSTRAINT alpha_decisions_confidence_tier_check;
  END IF;

  -- Add updated constraint with all valid tiers (old + new)
  ALTER TABLE alpha_decisions
    ADD CONSTRAINT alpha_decisions_confidence_tier_check
    CHECK (confidence_tier IN (
      'no_read', 'low', 'cautious', 'moderate', 'confident', 'high', 'very_high', 'extreme',
      'very_confident', 'extremely_confident'
    ));
END $$;
