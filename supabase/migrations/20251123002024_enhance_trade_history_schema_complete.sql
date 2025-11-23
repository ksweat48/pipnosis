/*
  # Enhance Trade History Schema - Complete Implementation

  Adds all missing columns to trade_history table for full synthetic backtest data capture.
  
  New Columns:
  - Session tracking: session_id, session_name, timeframe
  - Performance metrics: pnl_percent, pips_gained, outcome
  - AI analysis: ai_reasoning_used, ai_conviction, ai_rationale
  - Trade quality: quality_score, holding_duration_minutes
  - Execution: risk_reward_ratio, execution_reason
  - Source: is_synthetic, direction
*/

-- Add Session Tracking Columns
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trade_history' AND column_name = 'session_id') THEN
    ALTER TABLE trade_history ADD COLUMN session_id uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trade_history' AND column_name = 'session_name') THEN
    ALTER TABLE trade_history ADD COLUMN session_name text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trade_history' AND column_name = 'timeframe') THEN
    ALTER TABLE trade_history ADD COLUMN timeframe text;
  END IF;
END $$;

-- Add Performance Metrics Columns
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trade_history' AND column_name = 'pnl_percent') THEN
    ALTER TABLE trade_history ADD COLUMN pnl_percent numeric(10,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trade_history' AND column_name = 'pips_gained') THEN
    ALTER TABLE trade_history ADD COLUMN pips_gained numeric(10,1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trade_history' AND column_name = 'outcome') THEN
    ALTER TABLE trade_history ADD COLUMN outcome text CHECK (outcome IN ('win', 'loss', 'breakeven'));
  END IF;
END $$;

-- Add AI Analysis Columns
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trade_history' AND column_name = 'ai_reasoning_used') THEN
    ALTER TABLE trade_history ADD COLUMN ai_reasoning_used text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trade_history' AND column_name = 'ai_conviction') THEN
    ALTER TABLE trade_history ADD COLUMN ai_conviction numeric(5,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trade_history' AND column_name = 'ai_rationale') THEN
    ALTER TABLE trade_history ADD COLUMN ai_rationale text;
  END IF;
END $$;

-- Add Trade Quality Columns
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trade_history' AND column_name = 'quality_score') THEN
    ALTER TABLE trade_history ADD COLUMN quality_score numeric(5,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trade_history' AND column_name = 'holding_duration_minutes') THEN
    ALTER TABLE trade_history ADD COLUMN holding_duration_minutes integer;
  END IF;
END $$;

-- Add Execution Details Columns
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trade_history' AND column_name = 'risk_reward_ratio') THEN
    ALTER TABLE trade_history ADD COLUMN risk_reward_ratio numeric(10,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trade_history' AND column_name = 'execution_reason') THEN
    ALTER TABLE trade_history ADD COLUMN execution_reason text;
  END IF;
END $$;

-- Add Source Tracking Columns
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trade_history' AND column_name = 'is_synthetic') THEN
    ALTER TABLE trade_history ADD COLUMN is_synthetic boolean DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trade_history' AND column_name = 'direction') THEN
    ALTER TABLE trade_history ADD COLUMN direction text CHECK (direction IN ('buy', 'sell'));
  END IF;
END $$;

-- Create Indexes for Performance
CREATE INDEX IF NOT EXISTS idx_trade_history_session_id ON trade_history(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trade_history_session_name ON trade_history(session_name) WHERE session_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trade_history_timeframe ON trade_history(timeframe) WHERE timeframe IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trade_history_outcome ON trade_history(outcome) WHERE outcome IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trade_history_synthetic_user_closed ON trade_history(user_id, is_synthetic, closed_at DESC) WHERE is_synthetic = true;
CREATE INDEX IF NOT EXISTS idx_trade_history_quality_score ON trade_history(quality_score DESC) WHERE quality_score IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trade_history_ai_conviction ON trade_history(ai_conviction DESC) WHERE ai_conviction IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trade_history_outcome_pnl ON trade_history(user_id, outcome, profit_loss DESC) WHERE outcome IS NOT NULL;

-- Helper function for synthetic backtest stats
CREATE OR REPLACE FUNCTION get_synthetic_backtest_stats(p_user_id uuid, p_session_id uuid DEFAULT NULL)
RETURNS TABLE (
  total_trades bigint, winning_trades bigint, losing_trades bigint, breakeven_trades bigint,
  win_rate numeric, total_pips numeric, avg_pips_per_trade numeric, total_pnl numeric,
  avg_pnl_per_trade numeric, avg_holding_minutes numeric, avg_quality_score numeric,
  avg_ai_conviction numeric, best_trade_pnl numeric, worst_trade_pnl numeric,
  best_trade_pips numeric, worst_trade_pips numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::bigint, COUNT(CASE WHEN outcome = 'win' THEN 1 END)::bigint,
    COUNT(CASE WHEN outcome = 'loss' THEN 1 END)::bigint, COUNT(CASE WHEN outcome = 'breakeven' THEN 1 END)::bigint,
    CASE WHEN COUNT(*) > 0 THEN ROUND((COUNT(CASE WHEN outcome = 'win' THEN 1 END)::numeric / COUNT(*)::numeric) * 100, 2) ELSE 0 END,
    COALESCE(SUM(pips_gained), 0), COALESCE(AVG(pips_gained), 0), COALESCE(SUM(profit_loss), 0),
    COALESCE(AVG(profit_loss), 0), COALESCE(AVG(holding_duration_minutes), 0), COALESCE(AVG(quality_score), 0),
    COALESCE(AVG(ai_conviction), 0), COALESCE(MAX(profit_loss), 0), COALESCE(MIN(profit_loss), 0),
    COALESCE(MAX(pips_gained), 0), COALESCE(MIN(pips_gained), 0)
  FROM trade_history
  WHERE user_id = p_user_id AND is_synthetic = true AND (p_session_id IS NULL OR session_id = p_session_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to keep direction and position_type in sync
CREATE OR REPLACE FUNCTION sync_direction_and_position_type() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.direction IS NOT NULL AND NEW.position_type IS NULL THEN NEW.position_type := NEW.direction; END IF;
  IF NEW.position_type IS NOT NULL AND NEW.direction IS NULL THEN NEW.direction := NEW.position_type; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sync_direction_position_type ON trade_history;
CREATE TRIGGER trigger_sync_direction_position_type BEFORE INSERT OR UPDATE ON trade_history
  FOR EACH ROW EXECUTE FUNCTION sync_direction_and_position_type();