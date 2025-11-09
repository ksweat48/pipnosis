/*
  # Add Live Trade Links to AI Learning Tables

  1. Changes
    - Add `live_trade_id` to ai_trade_analysis table
    - Add `live_trade_id` to ai_learning_insights table
    - Create indexes for efficient live trade lookups

  2. Security
    - Maintain existing RLS policies
*/

-- ============================================================================
-- STEP 1: Add live_trade_id to ai_trade_analysis
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_trade_analysis' AND column_name = 'live_trade_id'
  ) THEN
    ALTER TABLE ai_trade_analysis
    ADD COLUMN live_trade_id uuid REFERENCES trade_history(id) ON DELETE SET NULL;

    COMMENT ON COLUMN ai_trade_analysis.live_trade_id IS 'Links to live demo trade in trade_history table';
  END IF;
END $$;

-- ============================================================================
-- STEP 2: Add live_trade_id to ai_learning_insights
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_learning_insights' AND column_name = 'live_trade_id'
  ) THEN
    ALTER TABLE ai_learning_insights
    ADD COLUMN live_trade_id uuid REFERENCES trade_history(id) ON DELETE SET NULL;

    COMMENT ON COLUMN ai_learning_insights.live_trade_id IS 'Links to live demo trade that generated this insight';
  END IF;
END $$;

-- ============================================================================
-- STEP 3: Create indexes for live trade lookups
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_ai_trade_analysis_live_trade
  ON ai_trade_analysis(live_trade_id)
  WHERE live_trade_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_learning_insights_live_trade
  ON ai_learning_insights(live_trade_id)
  WHERE live_trade_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_learning_insights_weight
  ON ai_learning_insights(user_id, learning_weight DESC, confidence_score DESC);
