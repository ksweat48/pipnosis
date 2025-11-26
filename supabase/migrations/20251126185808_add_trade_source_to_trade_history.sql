/*
  # Add Trade Source Field to Trade History

  1. Problem
    - "Historical Live Demo Trades" section counts ALL trades (including backtests)
    - No way to distinguish between live demo trades vs synthetic backtest trades

  2. Solution
    - Add `trade_source` column to `trade_history` table
    - Values: 'live_demo', 'synthetic_backtest', 'real_backtest'
    - Update function to filter by trade_source

  3. Changes
    - Add trade_source column with constraint
    - Add index for performance
    - Update get_live_learning_stats() to filter by 'live_demo'
    - Backfill existing data based on position_id presence

  4. Impact
    - Live demo section will only show live trades
    - Backtest trades won't inflate live demo statistics
*/

-- ============================================================================
-- STEP 1: Add trade_source column to trade_history
-- ============================================================================

ALTER TABLE trade_history 
ADD COLUMN IF NOT EXISTS trade_source text 
CHECK (trade_source IN ('live_demo', 'synthetic_backtest', 'real_backtest'))
DEFAULT 'live_demo';

-- Add comment
COMMENT ON COLUMN trade_history.trade_source IS 
  'Source of the trade: live_demo (real-time paper trading), synthetic_backtest (historical simulation), real_backtest (historical with real data)';

-- ============================================================================
-- STEP 2: Create index for performance
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_trade_history_source 
ON trade_history(user_id, trade_source, closed_at DESC);

-- ============================================================================
-- STEP 3: Backfill existing data
-- ============================================================================

-- Mark trades with position_id as live demo trades
UPDATE trade_history 
SET trade_source = 'live_demo' 
WHERE position_id IS NOT NULL 
  AND trade_source IS NULL;

-- Mark trades without position_id as synthetic backtest trades
UPDATE trade_history 
SET trade_source = 'synthetic_backtest' 
WHERE position_id IS NULL 
  AND trade_source IS NULL;

-- ============================================================================
-- STEP 4: Update get_live_learning_stats() function
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
  WHERE th.user_id = p_user_id
    AND th.trade_source = 'live_demo';  -- KEY FIX: Only count live demo trades
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_live_learning_stats IS 
  'Returns statistics for LIVE DEMO trades only (excludes synthetic backtests)';
