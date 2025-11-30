/*
  # Create Strategy Playbook System - Deep Memory & Auto-Updating

  ## Overview
  This migration creates the Deep Strategy Memory system that enables Pipnosis to:
  - Remember which strategies work best per symbol/timeframe/regime
  - Auto-promote high-performing strategy variants
  - Continuously evolve strategy parameters based on real trade results
  - Provide historical context to Alpha + Omega for better decisions

  ## New Tables

  ### `strategy_playbook`
  Stores strategy definitions (the "what to trade" blueprint)
  - Strategy name, symbol, timeframe, mode, regime bucket
  - Version tracking for evolution over time
  - Active/default flag for current best performer
  - Base parameters (SL/TP/risk/filters) in JSONB

  ### `strategy_variant_stats`
  Stores performance metrics for each playbook variant
  - Trade count, win/loss counts, win rate
  - Average R:R, PnL in R units
  - Max drawdown, best/worst runs
  - Internal ranking score for auto-promotion

  ## Security
  - RLS enabled on all tables
  - Users can only access their own playbooks
  - Service role can read/write for system operations

  ## Indexes
  - Optimized for playbook lookup by (symbol, timeframe, mode, regime_bucket)
  - Fast filtering by active defaults
  - Performance tracking by playbook_id
*/

-- =====================================================
-- TABLE: strategy_playbook
-- =====================================================

CREATE TABLE IF NOT EXISTS strategy_playbook (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  symbol text NOT NULL,
  timeframe text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('trend', 'breakout', 'reversal', 'range', 'scalp')),
  version integer NOT NULL DEFAULT 1,
  is_active_default boolean NOT NULL DEFAULT false,
  regime_bucket text NOT NULL,
  base_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  meta_notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_playbook_lookup
  ON strategy_playbook(user_id, symbol, timeframe, mode, regime_bucket, is_active_default);

CREATE INDEX IF NOT EXISTS idx_playbook_active
  ON strategy_playbook(user_id, symbol, timeframe, mode, regime_bucket)
  WHERE is_active_default = true;

CREATE INDEX IF NOT EXISTS idx_playbook_version
  ON strategy_playbook(user_id, symbol, timeframe, mode, regime_bucket, version);

CREATE INDEX IF NOT EXISTS idx_playbook_created
  ON strategy_playbook(created_at DESC);

-- =====================================================
-- TABLE: strategy_variant_stats
-- =====================================================

CREATE TABLE IF NOT EXISTS strategy_variant_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playbook_id uuid REFERENCES strategy_playbook(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  symbol text NOT NULL,
  timeframe text NOT NULL,
  mode text NOT NULL,
  regime_bucket text NOT NULL,

  -- Performance metrics
  trades_count integer NOT NULL DEFAULT 0,
  wins_count integer NOT NULL DEFAULT 0,
  losses_count integer NOT NULL DEFAULT 0,
  breakeven_count integer NOT NULL DEFAULT 0,
  win_rate float NOT NULL DEFAULT 0,

  -- R-based metrics (risk-normalized)
  avg_rr float NOT NULL DEFAULT 0,
  avg_pnl_r float NOT NULL DEFAULT 0,
  total_pnl_r float NOT NULL DEFAULT 0,
  max_drawdown_r float NOT NULL DEFAULT 0,
  best_run_r float NOT NULL DEFAULT 0,
  worst_run_r float NOT NULL DEFAULT 0,

  -- Scoring and ranking
  score float NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  last_promotion_check timestamptz,

  -- Metadata
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for performance tracking
CREATE INDEX IF NOT EXISTS idx_variant_stats_playbook
  ON strategy_variant_stats(playbook_id);

CREATE INDEX IF NOT EXISTS idx_variant_stats_lookup
  ON strategy_variant_stats(user_id, symbol, timeframe, mode, regime_bucket);

CREATE INDEX IF NOT EXISTS idx_variant_stats_score
  ON strategy_variant_stats(user_id, symbol, timeframe, mode, regime_bucket, score DESC);

CREATE INDEX IF NOT EXISTS idx_variant_stats_last_used
  ON strategy_variant_stats(last_used_at DESC);

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================

ALTER TABLE strategy_playbook ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_variant_stats ENABLE ROW LEVEL SECURITY;

-- strategy_playbook policies
CREATE POLICY "Users can view own playbooks"
  ON strategy_playbook FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own playbooks"
  ON strategy_playbook FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own playbooks"
  ON strategy_playbook FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own playbooks"
  ON strategy_playbook FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Service role full access
CREATE POLICY "Service role full access to playbooks"
  ON strategy_playbook FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- strategy_variant_stats policies
CREATE POLICY "Users can view own variant stats"
  ON strategy_variant_stats FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own variant stats"
  ON strategy_variant_stats FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own variant stats"
  ON strategy_variant_stats FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own variant stats"
  ON strategy_variant_stats FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Service role full access
CREATE POLICY "Service role full access to variant stats"
  ON strategy_variant_stats FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Function to update playbook updated_at timestamp
CREATE OR REPLACE FUNCTION update_playbook_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_playbook_updated_at
  BEFORE UPDATE ON strategy_playbook
  FOR EACH ROW
  EXECUTE FUNCTION update_playbook_timestamp();

-- Function to update variant stats updated_at timestamp
CREATE OR REPLACE FUNCTION update_variant_stats_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_variant_stats_updated_at
  BEFORE UPDATE ON strategy_variant_stats
  FOR EACH ROW
  EXECUTE FUNCTION update_variant_stats_timestamp();

-- =====================================================
-- UTILITY VIEWS
-- =====================================================

-- View for active playbooks with their stats
CREATE OR REPLACE VIEW active_playbooks_with_stats AS
SELECT
  p.id,
  p.user_id,
  p.name,
  p.symbol,
  p.timeframe,
  p.mode,
  p.regime_bucket,
  p.version,
  p.base_params,
  p.meta_notes,
  p.created_at,
  p.updated_at,
  COALESCE(s.trades_count, 0) as trades_count,
  COALESCE(s.win_rate, 0) as win_rate,
  COALESCE(s.avg_pnl_r, 0) as avg_pnl_r,
  COALESCE(s.score, 0) as score,
  s.last_used_at
FROM strategy_playbook p
LEFT JOIN strategy_variant_stats s ON s.playbook_id = p.id
WHERE p.is_active_default = true;

-- =====================================================
-- INITIAL DATA COMMENTS
-- =====================================================

COMMENT ON TABLE strategy_playbook IS 'Stores strategy definitions for deep memory system. Each playbook is a strategy variant with specific parameters.';
COMMENT ON TABLE strategy_variant_stats IS 'Tracks performance metrics for each strategy playbook variant. Used for auto-promotion of best performers.';

COMMENT ON COLUMN strategy_playbook.regime_bucket IS 'Market regime classification: trend_high_vol, trend_normal, range_normal, compression_adversarial, etc.';
COMMENT ON COLUMN strategy_playbook.base_params IS 'Strategy parameters: rr_target, sl_factor_atr, tp_factor_atr, risk_pct, entry_filters';
COMMENT ON COLUMN strategy_playbook.is_active_default IS 'Current best-performing variant for this (symbol, timeframe, mode, regime_bucket)';

COMMENT ON COLUMN strategy_variant_stats.score IS 'Ranking score calculated as: (win_rate * 50) + (avg_pnl_r * 30) - (max_drawdown_r * 10) + (min(trades, 50) * 0.3)';
COMMENT ON COLUMN strategy_variant_stats.avg_pnl_r IS 'Average profit/loss in R units (risk-normalized)';
COMMENT ON COLUMN strategy_variant_stats.max_drawdown_r IS 'Maximum consecutive losing streak in R units';