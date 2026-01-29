/*
  # CCIP: Add Market Assessment Fields to Goal Sessions

  ## Change Control Intelligence Protocol (CCIP)

  **Change ID**: CCIP-20260129-001
  **Severity**: Medium
  **Impact**: Schema addition (non-breaking)
  **Rollback**: Simple column drop if needed

  ## Purpose

  Adds market assessment storage to goal_sessions to enable market-aligned TP calculations.
  Alpha's predictions (e.g., "market can give $100-$120") will now be stored and used for:
  - Setting realistic TP levels based on market potential
  - Preventing session targets from exceeding market capability
  - Validating trade feasibility against Alpha's assessment

  ## Changes

  1. **New Columns**:
     - `predicted_profit_min`: Alpha's minimum expected profit (conservative estimate)
     - `predicted_profit_max`: Alpha's maximum expected profit (optimistic estimate)
     - `market_assessment_confidence`: Alpha's confidence in this prediction (0-100)
     - `market_assessment_reasoning`: Why Alpha believes this is the market potential

  2. **Security**: RLS policies automatically cover new columns

  3. **Compatibility**: Nullable fields, existing sessions continue working

  ## SSOT Compliance

  - Single source of truth for Alpha's market predictions
  - Replaces arbitrary goal percentage calculations
  - TP calculations will reference these fields as authority

  ## Governance

  - Only Alpha can write market assessments (via alpha-execution-planner)
  - Frontend displays Alpha's reasoning for transparency
  - Session targets cannot exceed predicted_profit_max + small buffer
*/

-- Add market assessment fields to goal_sessions
DO $$
BEGIN
  -- predicted_profit_min: Conservative estimate of market potential
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'predicted_profit_min'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN predicted_profit_min DECIMAL(20, 2);
    COMMENT ON COLUMN goal_sessions.predicted_profit_min IS 'Alpha''s conservative estimate of market profit potential';
  END IF;

  -- predicted_profit_max: Optimistic estimate of market potential
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'predicted_profit_max'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN predicted_profit_max DECIMAL(20, 2);
    COMMENT ON COLUMN goal_sessions.predicted_profit_max IS 'Alpha''s optimistic estimate of market profit potential';
  END IF;

  -- market_assessment_confidence: Alpha's confidence in prediction
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'market_assessment_confidence'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN market_assessment_confidence DECIMAL(5, 2);
    COMMENT ON COLUMN goal_sessions.market_assessment_confidence IS 'Alpha''s confidence in market assessment (0-100)';
  END IF;

  -- market_assessment_reasoning: Why Alpha set this range
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'market_assessment_reasoning'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN market_assessment_reasoning TEXT;
    COMMENT ON COLUMN goal_sessions.market_assessment_reasoning IS 'Alpha''s explanation for predicted profit range';
  END IF;

  -- Add constraint: max >= min when both are set
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'market_assessment_range_valid'
  ) THEN
    ALTER TABLE goal_sessions ADD CONSTRAINT market_assessment_range_valid
      CHECK (
        (predicted_profit_min IS NULL AND predicted_profit_max IS NULL) OR
        (predicted_profit_max >= predicted_profit_min)
      );
  END IF;

  -- Add constraint: confidence between 0-100 when set
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'market_assessment_confidence_range'
  ) THEN
    ALTER TABLE goal_sessions ADD CONSTRAINT market_assessment_confidence_range
      CHECK (
        market_assessment_confidence IS NULL OR
        (market_assessment_confidence >= 0 AND market_assessment_confidence <= 100)
      );
  END IF;
END $$;

-- Create index for querying sessions by market assessment
CREATE INDEX IF NOT EXISTS idx_goal_sessions_market_assessment
  ON goal_sessions(predicted_profit_max)
  WHERE predicted_profit_max IS NOT NULL;