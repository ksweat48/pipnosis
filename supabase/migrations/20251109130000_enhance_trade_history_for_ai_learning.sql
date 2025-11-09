/*
  # Enhance Trade History for AI Learning Integration

  1. New Columns
    - `confidence_score` (numeric) - AI's confidence level when trade was taken (0-100)
    - `setup_type` (text) - The pattern/setup that triggered the trade
    - `market_conditions` (jsonb) - Market state at entry time (trend, volatility, etc.)
    - `ai_decision_id` (uuid) - Links to ai_decision_feedback for outcome tracking
    - `ai_analyzed` (boolean) - Tracks whether AI has learned from this trade yet
    - `ai_analyzed_at` (timestamptz) - When AI learning analysis was completed

  2. Updates to ai_learning_insights
    - `learning_weight` (numeric) - Weight multiplier for this insight (2.0 for live, 1.0 for backtest)
    - `learned_from_live_trading` (boolean) - Quick flag to distinguish learning source

  3. New Table: trade_learning_log
    - Tracks when each trade is analyzed by AI
    - Records what was learned from each trade
    - Enables audit trail and debugging

  4. Security
    - Maintain existing RLS policies
    - Add policies for new trade_learning_log table
*/

-- ============================================================================
-- STEP 1: Enhance trade_history table with AI learning fields
-- ============================================================================

DO $$
BEGIN
  -- Add confidence_score if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trade_history' AND column_name = 'confidence_score'
  ) THEN
    ALTER TABLE trade_history ADD COLUMN confidence_score numeric(5,2) DEFAULT 75.0;
  END IF;

  -- Add setup_type if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trade_history' AND column_name = 'setup_type'
  ) THEN
    ALTER TABLE trade_history ADD COLUMN setup_type text;
  END IF;

  -- Add market_conditions if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trade_history' AND column_name = 'market_conditions'
  ) THEN
    ALTER TABLE trade_history ADD COLUMN market_conditions jsonb DEFAULT '{}'::jsonb;
  END IF;

  -- Add ai_decision_id if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trade_history' AND column_name = 'ai_decision_id'
  ) THEN
    ALTER TABLE trade_history ADD COLUMN ai_decision_id uuid REFERENCES ai_decision_feedback(id) ON DELETE SET NULL;
  END IF;

  -- Add ai_analyzed flag if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trade_history' AND column_name = 'ai_analyzed'
  ) THEN
    ALTER TABLE trade_history ADD COLUMN ai_analyzed boolean DEFAULT false;
  END IF;

  -- Add ai_analyzed_at timestamp if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trade_history' AND column_name = 'ai_analyzed_at'
  ) THEN
    ALTER TABLE trade_history ADD COLUMN ai_analyzed_at timestamptz;
  END IF;
END $$;

-- ============================================================================
-- STEP 2: Enhance ai_learning_insights with weighting system
-- ============================================================================

DO $$
BEGIN
  -- Add learning_weight if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_learning_insights' AND column_name = 'learning_weight'
  ) THEN
    ALTER TABLE ai_learning_insights ADD COLUMN learning_weight numeric(3,1) DEFAULT 1.0;
    COMMENT ON COLUMN ai_learning_insights.learning_weight IS 'Weight multiplier: 2.0 for live trades, 1.0 for backtests, 0.5 for old data';
  END IF;

  -- Add learned_from_live_trading flag if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_learning_insights' AND column_name = 'learned_from_live_trading'
  ) THEN
    ALTER TABLE ai_learning_insights ADD COLUMN learned_from_live_trading boolean DEFAULT false;
  END IF;

  -- Update existing is_from_live_trading records to have proper weight
  UPDATE ai_learning_insights
  SET learning_weight = 2.0, learned_from_live_trading = true
  WHERE is_from_live_trading = true AND learning_weight = 1.0;
END $$;

-- ============================================================================
-- STEP 3: Create trade_learning_log table
-- ============================================================================

CREATE TABLE IF NOT EXISTS trade_learning_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  trade_id uuid NOT NULL REFERENCES trade_history(id) ON DELETE CASCADE,
  analyzed_at timestamptz DEFAULT now(),

  -- Trade details at time of analysis
  symbol text NOT NULL,
  position_type text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('win', 'loss', 'breakeven')),
  pnl numeric(15,2) NOT NULL,
  confidence_at_entry numeric(5,2),

  -- What was learned
  patterns_identified text[] DEFAULT ARRAY[]::text[],
  insights_created integer DEFAULT 0,
  key_learnings text[] DEFAULT ARRAY[]::text[],
  mistakes_identified text[] DEFAULT ARRAY[]::text[],

  -- Learning quality metrics
  learning_quality_score numeric(5,2) DEFAULT 0,
  will_improve_future_decisions boolean DEFAULT true,
  similar_historical_trades_count integer DEFAULT 0,

  -- Metadata
  learning_source text DEFAULT 'live_trading' CHECK (learning_source IN ('live_trading', 'synthetic_backtest', 'historical_backtest')),
  processing_time_ms integer,
  created_at timestamptz DEFAULT now()
);

-- Create indexes for trade_learning_log
CREATE INDEX IF NOT EXISTS idx_trade_learning_log_user_analyzed
  ON trade_learning_log(user_id, analyzed_at DESC);

CREATE INDEX IF NOT EXISTS idx_trade_learning_log_trade
  ON trade_learning_log(trade_id);

CREATE INDEX IF NOT EXISTS idx_trade_learning_log_symbol_outcome
  ON trade_learning_log(symbol, outcome);

-- ============================================================================
-- STEP 4: Create indexes for enhanced trade_history fields
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_trade_history_ai_analyzed
  ON trade_history(user_id, ai_analyzed, closed_at DESC)
  WHERE ai_analyzed = false;

CREATE INDEX IF NOT EXISTS idx_trade_history_confidence
  ON trade_history(confidence_score DESC);

CREATE INDEX IF NOT EXISTS idx_trade_history_setup_type
  ON trade_history(setup_type)
  WHERE setup_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_trade_history_ai_decision
  ON trade_history(ai_decision_id)
  WHERE ai_decision_id IS NOT NULL;

-- ============================================================================
-- STEP 5: Enable RLS on trade_learning_log
-- ============================================================================

ALTER TABLE trade_learning_log ENABLE ROW LEVEL SECURITY;

-- Users can view their own learning logs
CREATE POLICY "Users can view own learning logs"
  ON trade_learning_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can create their own learning logs (system-generated)
CREATE POLICY "Users can create own learning logs"
  ON trade_learning_log FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Admins can view all learning logs
CREATE POLICY "Admins can view all learning logs"
  ON trade_learning_log FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- ============================================================================
-- STEP 6: Create helper function to get unanalyzed trades
-- ============================================================================

CREATE OR REPLACE FUNCTION get_unanalyzed_trades(p_user_id uuid, p_limit integer DEFAULT 50)
RETURNS TABLE (
  id uuid,
  symbol text,
  position_type text,
  entry_price numeric,
  exit_price numeric,
  stop_loss numeric,
  take_profit numeric,
  profit_loss numeric,
  opened_at timestamptz,
  closed_at timestamptz,
  close_reason text,
  confidence_score numeric,
  setup_type text,
  market_conditions jsonb,
  strategy_name text
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    th.id,
    th.symbol,
    th.position_type,
    th.entry_price,
    th.exit_price,
    th.stop_loss,
    th.take_profit,
    th.profit_loss,
    th.opened_at,
    th.closed_at,
    th.close_reason,
    th.confidence_score,
    th.setup_type,
    th.market_conditions,
    th.strategy_name
  FROM trade_history th
  WHERE th.user_id = p_user_id
    AND th.ai_analyzed = false
  ORDER BY th.closed_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- STEP 7: Create function to mark trade as analyzed
-- ============================================================================

CREATE OR REPLACE FUNCTION mark_trade_analyzed(
  p_trade_id uuid,
  p_user_id uuid
)
RETURNS boolean AS $$
DECLARE
  v_updated boolean;
BEGIN
  UPDATE trade_history
  SET
    ai_analyzed = true,
    ai_analyzed_at = now()
  WHERE id = p_trade_id
    AND user_id = p_user_id
    AND ai_analyzed = false;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- STEP 8: Create function to get live trading learning statistics
-- ============================================================================

CREATE OR REPLACE FUNCTION get_live_learning_stats(p_user_id uuid)
RETURNS TABLE (
  total_live_trades bigint,
  trades_analyzed bigint,
  trades_pending_analysis bigint,
  live_insights_created bigint,
  avg_learning_quality numeric,
  total_patterns_identified bigint,
  last_analysis_time timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(DISTINCT th.id)::bigint as total_live_trades,
    COUNT(DISTINCT CASE WHEN th.ai_analyzed THEN th.id END)::bigint as trades_analyzed,
    COUNT(DISTINCT CASE WHEN NOT th.ai_analyzed THEN th.id END)::bigint as trades_pending_analysis,
    COUNT(DISTINCT tll.id)::bigint as live_insights_created,
    COALESCE(AVG(tll.learning_quality_score), 0) as avg_learning_quality,
    COALESCE(SUM(array_length(tll.patterns_identified, 1)), 0)::bigint as total_patterns_identified,
    MAX(tll.analyzed_at) as last_analysis_time
  FROM trade_history th
  LEFT JOIN trade_learning_log tll ON tll.trade_id = th.id
  WHERE th.user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- STEP 9: Add comments for documentation
-- ============================================================================

COMMENT ON TABLE trade_learning_log IS 'Tracks AI learning analysis from each completed trade';
COMMENT ON COLUMN trade_history.confidence_score IS 'AI confidence level (0-100) when trade was opened';
COMMENT ON COLUMN trade_history.setup_type IS 'Pattern/setup that triggered the trade (e.g., Flow Trader V2, RSI Divergence)';
COMMENT ON COLUMN trade_history.market_conditions IS 'JSON of market state at entry: trend, volatility, indicators, etc.';
COMMENT ON COLUMN trade_history.ai_decision_id IS 'Links to AI decision feedback for outcome validation';
COMMENT ON COLUMN trade_history.ai_analyzed IS 'Whether AI has extracted learnings from this trade';
COMMENT ON COLUMN trade_history.ai_analyzed_at IS 'Timestamp when AI learning analysis completed';
