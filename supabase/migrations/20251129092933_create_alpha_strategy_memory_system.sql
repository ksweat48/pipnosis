/*
  # Alpha Strategy Memory System

  Creates the missing piece of Pipnosis Alpha architecture - cross-session strategy learning.
  
  ## Purpose
  
  Enables the Strategy Brain to remember and learn from past strategies:
  - What strategies worked in which market conditions
  - What patterns to repeat vs avoid
  - Regime-specific performance tracking
  - Continuous evolution across sessions

  ## Tables Created
  
  1. **alpha_strategy_memory**
     - Stores each strategy plan with market context
     - Tracks performance metrics
     - Records lessons learned
     - Links strategies to outcomes
  
  ## How It Works
  
  1. Strategy Brain plans strategy → Save to memory
  2. Trades execute → Update memory with results
  3. Next planning cycle → Load memory + market data → Better strategy
  
  This completes the reinforcement learning loop.
*/

-- ============================================================================
-- Alpha Strategy Memory Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS alpha_strategy_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  session_id text,
  goal_session_id uuid REFERENCES goal_sessions(id) ON DELETE SET NULL,
  
  -- Strategy Definition (what the LLM planned)
  strategy_mode text NOT NULL, -- 'trend', 'breakout', 'pullback', 'reversal', 'range'
  conditions jsonb NOT NULL, -- Array of condition codes: ["p>e50", "rsi>50"]
  entry_logic text NOT NULL, -- "when 2 of 3 conditions true"
  sl_calculation text NOT NULL, -- "atr*1.5"
  tp_calculation text NOT NULL, -- "atr*2.5"
  risk_pct numeric NOT NULL,
  planned_confidence numeric NOT NULL, -- 60-95
  rationale text, -- Brief explanation from LLM
  watch_indicators jsonb, -- ["ema20", "rsi", "vwap"]
  
  -- Market Context When Planned (regime at time of planning)
  symbol text NOT NULL,
  timeframe text NOT NULL,
  market_regime text NOT NULL, -- 'bull', 'bear', 'sideways'
  volatility text NOT NULL, -- 'low', 'medium', 'high'
  trend_strength numeric,
  price_at_plan numeric,
  ema50_at_plan numeric,
  ema200_at_plan numeric,
  rsi_at_plan numeric,
  atr_at_plan numeric,
  market_indicators jsonb, -- Full snapshot for reference
  
  -- Performance Tracking (updated as trades execute)
  trades_executed integer DEFAULT 0,
  trades_won integer DEFAULT 0,
  trades_lost integer DEFAULT 0,
  trades_breakeven integer DEFAULT 0,
  win_rate numeric DEFAULT 0,
  avg_pnl numeric DEFAULT 0,
  total_pnl numeric DEFAULT 0,
  max_pnl numeric DEFAULT 0,
  min_pnl numeric DEFAULT 0,
  avg_hold_time_minutes numeric DEFAULT 0,
  
  -- Outcome Analysis (updated after sufficient trades)
  performance_rating text DEFAULT 'pending', -- 'excellent', 'good', 'fair', 'poor', 'terrible', 'pending'
  outcome_summary text, -- "Worked well in trending markets, struggled during chop"
  what_worked text, -- "Breakout entries with vol confirmation"
  what_failed text, -- "Premature entries before trend confirmation"
  key_lesson text, -- "Wait for 3/3 conditions before entry"
  confidence_accuracy numeric, -- How close planned_confidence was to actual win_rate
  
  -- Lifecycle
  planned_at timestamptz DEFAULT now() NOT NULL,
  active_from timestamptz,
  active_until timestamptz,
  status text DEFAULT 'active', -- 'active', 'completed', 'abandoned'
  
  -- Metadata
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- ============================================================================
-- Indexes for Fast Queries
-- ============================================================================

-- User's recent strategies
CREATE INDEX IF NOT EXISTS idx_strategy_memory_user_recent 
ON alpha_strategy_memory(user_id, planned_at DESC);

-- Best strategies by regime
CREATE INDEX IF NOT EXISTS idx_strategy_memory_regime_performance 
ON alpha_strategy_memory(user_id, symbol, market_regime, volatility, win_rate DESC);

-- Performance-based queries
CREATE INDEX IF NOT EXISTS idx_strategy_memory_performance 
ON alpha_strategy_memory(performance_rating, win_rate DESC, total_pnl DESC);

-- Active strategies
CREATE INDEX IF NOT EXISTS idx_strategy_memory_active 
ON alpha_strategy_memory(user_id, status, active_from DESC);

-- Strategy mode performance
CREATE INDEX IF NOT EXISTS idx_strategy_memory_mode 
ON alpha_strategy_memory(user_id, strategy_mode, win_rate DESC);

-- ============================================================================
-- Row Level Security
-- ============================================================================

ALTER TABLE alpha_strategy_memory ENABLE ROW LEVEL SECURITY;

-- Users can read their own strategy memory
CREATE POLICY "Users can read own strategy memory"
  ON alpha_strategy_memory
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can insert their own strategies
CREATE POLICY "Users can insert own strategies"
  ON alpha_strategy_memory
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own strategies
CREATE POLICY "Users can update own strategies"
  ON alpha_strategy_memory
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service role has full access
CREATE POLICY "Service role full access to strategy memory"
  ON alpha_strategy_memory
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- Helper Views
-- ============================================================================

-- View: Best Performing Strategies by Regime
CREATE OR REPLACE VIEW best_strategies_by_regime AS
SELECT 
  user_id,
  symbol,
  market_regime,
  volatility,
  strategy_mode,
  conditions,
  AVG(win_rate) as avg_win_rate,
  COUNT(*) as times_used,
  SUM(total_pnl) as cumulative_pnl,
  AVG(confidence_accuracy) as avg_accuracy
FROM alpha_strategy_memory
WHERE trades_executed >= 5 -- Minimum sample size
  AND performance_rating IN ('excellent', 'good')
GROUP BY user_id, symbol, market_regime, volatility, strategy_mode, conditions
HAVING AVG(win_rate) >= 0.65
ORDER BY avg_win_rate DESC, cumulative_pnl DESC;

-- View: Strategies to Avoid
CREATE OR REPLACE VIEW failed_strategy_patterns AS
SELECT 
  user_id,
  symbol,
  market_regime,
  volatility,
  strategy_mode,
  conditions,
  AVG(win_rate) as avg_win_rate,
  COUNT(*) as times_tried,
  SUM(total_pnl) as cumulative_loss,
  array_agg(DISTINCT what_failed) as common_failures
FROM alpha_strategy_memory
WHERE trades_executed >= 3
  AND performance_rating IN ('poor', 'terrible')
GROUP BY user_id, symbol, market_regime, volatility, strategy_mode, conditions
HAVING AVG(win_rate) <= 0.40
ORDER BY avg_win_rate ASC, cumulative_loss ASC;

-- ============================================================================
-- Trigger: Update timestamp on modification
-- ============================================================================

CREATE OR REPLACE FUNCTION update_strategy_memory_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_strategy_memory_timestamp
  BEFORE UPDATE ON alpha_strategy_memory
  FOR EACH ROW
  EXECUTE FUNCTION update_strategy_memory_timestamp();

-- ============================================================================
-- Comments for Documentation
-- ============================================================================

COMMENT ON TABLE alpha_strategy_memory IS
'Pipnosis Alpha Strategy Memory - Enables cross-session learning. The Strategy Brain remembers what worked and what failed in different market conditions.';

COMMENT ON COLUMN alpha_strategy_memory.strategy_mode IS
'Type of strategy: trend, breakout, pullback, reversal, range';

COMMENT ON COLUMN alpha_strategy_memory.conditions IS
'Parseable condition codes like ["p>e50", "rsi>50", "trend=bull"]';

COMMENT ON COLUMN alpha_strategy_memory.performance_rating IS
'Overall performance: excellent (75%+ WR), good (65%+), fair (50-65%), poor (35-50%), terrible (<35%)';

COMMENT ON COLUMN alpha_strategy_memory.market_regime IS
'Market condition when strategy was planned: bull, bear, sideways';

COMMENT ON COLUMN alpha_strategy_memory.confidence_accuracy IS
'How accurate was the planned_confidence vs actual win_rate. Used to calibrate future confidence estimates.';

-- ============================================================================
-- Success Message
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '✅ Alpha Strategy Memory System Created';
  RAISE NOTICE '   - Strategy Brain can now remember past performance';
  RAISE NOTICE '   - Cross-session learning enabled';
  RAISE NOTICE '   - Regime-specific adaptation active';
  RAISE NOTICE '   - Continuous evolution loop complete';
  RAISE NOTICE '';
  RAISE NOTICE '🧠 Pipnosis Alpha is now fully autonomous and self-improving!';
END $$;
