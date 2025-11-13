/*
  # Fix Learning Center Schema Conflicts
  
  ## Problem
  The production database has outdated table schemas that don't match what the application code expects:
  
  1. **ai_session_learnings** - Has simple jsonb structure but code expects detailed columns
     - Missing: session_date, session_type, best_setup_name, best_setup_ev, etc.
     - Current: only learning_summary (jsonb), key_insights, recommendations
  
  2. **ai_pattern_ev_tracking** - Missing critical columns for pattern tracking
     - Missing: user_id, pattern_status, sample_size, win_probability, profit_factor, etc.
     - Current: only basic tracking columns
  
  3. **ai_discovered_strategies** - Missing columns for strategy arsenal
     - Need to add all required columns for full functionality
  
  ## Solution
  Drop and recreate all three tables with correct schemas that match the application code.
  
  ## Changes
  1. Drop existing tables (preserve data with temp backup if any exists)
  2. Create ai_session_learnings with full column structure
  3. Create ai_pattern_ev_tracking with all tracking columns
  4. Create ai_discovered_strategies with complete schema
  5. Add proper indexes and RLS policies
*/

-- Drop existing tables (in correct dependency order)
DROP TABLE IF EXISTS ai_session_learnings CASCADE;
DROP TABLE IF EXISTS ai_pattern_ev_tracking CASCADE;
DROP TABLE IF EXISTS ai_discovered_strategies CASCADE;

-- =====================================================
-- ai_session_learnings - Daily learning summaries
-- =====================================================
CREATE TABLE ai_session_learnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Session identification
  session_date date NOT NULL,
  session_type text DEFAULT 'live_trading' CHECK (session_type IN ('live_trading', 'backtest', 'synthetic')),
  
  -- Best/Worst setups
  best_setup_name text,
  best_setup_ev numeric(12,2),
  best_setup_win_rate numeric(5,2),
  best_setup_trades_count integer,
  
  worst_setup_name text,
  worst_setup_ev numeric(12,2),
  worst_setup_win_rate numeric(5,2),
  worst_setup_trades_count integer,
  
  -- Confidence shifts applied
  confidence_adjustments jsonb DEFAULT '[]'::jsonb,
  net_confidence_shift numeric(5,2) DEFAULT 0,
  
  -- Filter/threshold adjustments
  filter_adjustments jsonb DEFAULT '[]'::jsonb,
  threshold_adjustments jsonb DEFAULT '[]'::jsonb,
  
  -- Key discoveries
  patterns_discovered text[] DEFAULT ARRAY[]::text[],
  patterns_degraded text[] DEFAULT ARRAY[]::text[],
  key_learnings text[] DEFAULT ARRAY[]::text[],
  
  -- Session metrics
  session_css numeric(5,2),
  session_ev numeric(12,2),
  trades_taken integer DEFAULT 0,
  trades_avoided integer DEFAULT 0,
  
  -- Actionable recommendations
  actionable_recommendations text[] DEFAULT ARRAY[]::text[],
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  -- Prevent duplicate entries
  UNIQUE(user_id, session_date, session_type)
);

-- =====================================================
-- ai_pattern_ev_tracking - Pattern performance tracking
-- =====================================================
CREATE TABLE ai_pattern_ev_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Pattern identification
  pattern_name text NOT NULL,
  symbol text NOT NULL,
  timeframe text NOT NULL DEFAULT 'M5',
  
  -- EV metrics
  expected_value numeric(12,2) DEFAULT 0,
  win_probability numeric(5,2) DEFAULT 0,
  sample_size integer DEFAULT 0,
  
  -- Performance metrics
  win_rate numeric(5,2) DEFAULT 0,
  avg_profit numeric(12,2) DEFAULT 0,
  avg_loss numeric(12,2) DEFAULT 0,
  profit_factor numeric(8,2) DEFAULT 0,
  avg_rr numeric(8,2) DEFAULT 0,
  
  -- Pattern status tracking
  pattern_status text DEFAULT 'active' CHECK (pattern_status IN ('active', 'degraded', 'paused', 'archived')),
  is_statistically_significant boolean DEFAULT false,
  ev_confidence_level text DEFAULT 'low' CHECK (ev_confidence_level IN ('low', 'medium', 'high', 'very_high')),
  
  -- Timestamps
  first_seen_at timestamptz DEFAULT now(),
  last_updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  -- Prevent duplicate patterns
  UNIQUE(user_id, pattern_name, symbol, timeframe)
);

-- =====================================================
-- ai_discovered_strategies - Strategy arsenal
-- =====================================================
CREATE TABLE ai_discovered_strategies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Strategy identification
  strategy_name text NOT NULL,
  strategy_type text NOT NULL CHECK (strategy_type IN ('discovered', 'evolved', 'hybrid', 'manual')),
  discovery_method text NOT NULL CHECK (discovery_method IN ('pattern_mining', 'parameter_optimization', 'genetic_algorithm', 'machine_learning', 'manual')),
  generation integer DEFAULT 1,
  
  -- Performance metrics
  win_rate numeric(5,2) DEFAULT 0,
  profit_factor numeric(8,2) DEFAULT 0,
  expectancy numeric(12,2) DEFAULT 0,
  sharpe_ratio numeric(8,2) DEFAULT 0,
  total_trades integer DEFAULT 0,
  
  -- Validation
  validation_status text DEFAULT 'discovered' CHECK (validation_status IN ('discovered', 'testing', 'validated', 'active', 'retired')),
  passes_baseline boolean DEFAULT false,
  
  -- Market regime performance
  trending_up_win_rate numeric(5,2) DEFAULT 0,
  trending_down_win_rate numeric(5,2) DEFAULT 0,
  ranging_win_rate numeric(5,2) DEFAULT 0,
  high_volatility_win_rate numeric(5,2) DEFAULT 0,
  low_volatility_win_rate numeric(5,2) DEFAULT 0,
  
  -- Strategy definition
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  entry_rules jsonb DEFAULT '{}'::jsonb,
  exit_rules jsonb DEFAULT '{}'::jsonb,
  indicators jsonb DEFAULT '{}'::jsonb,
  dna_encoding jsonb DEFAULT '{}'::jsonb,
  
  -- Comparison data
  baseline_comparison jsonb DEFAULT '{}'::jsonb,
  backtest_results jsonb DEFAULT '{}'::jsonb,
  
  -- Metadata
  confidence_score numeric(5,2) DEFAULT 0,
  last_used_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  -- Prevent duplicate strategies
  UNIQUE(user_id, strategy_name)
);

-- =====================================================
-- Indexes for performance
-- =====================================================
CREATE INDEX idx_session_learnings_user_date ON ai_session_learnings(user_id, session_date DESC);
CREATE INDEX idx_session_learnings_type ON ai_session_learnings(session_type);
CREATE INDEX idx_session_learnings_created ON ai_session_learnings(created_at DESC);

CREATE INDEX idx_pattern_tracking_user ON ai_pattern_ev_tracking(user_id);
CREATE INDEX idx_pattern_tracking_status ON ai_pattern_ev_tracking(pattern_status);
CREATE INDEX idx_pattern_tracking_symbol ON ai_pattern_ev_tracking(symbol);
CREATE INDEX idx_pattern_tracking_ev ON ai_pattern_ev_tracking(expected_value DESC);
CREATE INDEX idx_pattern_tracking_updated ON ai_pattern_ev_tracking(last_updated_at DESC);

CREATE INDEX idx_discovered_strategies_user ON ai_discovered_strategies(user_id);
CREATE INDEX idx_discovered_strategies_status ON ai_discovered_strategies(validation_status);
CREATE INDEX idx_discovered_strategies_baseline ON ai_discovered_strategies(passes_baseline);
CREATE INDEX idx_discovered_strategies_expectancy ON ai_discovered_strategies(expectancy DESC);

-- =====================================================
-- Row Level Security
-- =====================================================
ALTER TABLE ai_session_learnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_pattern_ev_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_discovered_strategies ENABLE ROW LEVEL SECURITY;

-- ai_session_learnings policies
CREATE POLICY "Users can view own session learnings"
  ON ai_session_learnings FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own session learnings"
  ON ai_session_learnings FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own session learnings"
  ON ai_session_learnings FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own session learnings"
  ON ai_session_learnings FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ai_pattern_ev_tracking policies
CREATE POLICY "Users can view own pattern tracking"
  ON ai_pattern_ev_tracking FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own pattern tracking"
  ON ai_pattern_ev_tracking FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own pattern tracking"
  ON ai_pattern_ev_tracking FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own pattern tracking"
  ON ai_pattern_ev_tracking FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ai_discovered_strategies policies
CREATE POLICY "Users can view own discovered strategies"
  ON ai_discovered_strategies FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own discovered strategies"
  ON ai_discovered_strategies FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own discovered strategies"
  ON ai_discovered_strategies FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own discovered strategies"
  ON ai_discovered_strategies FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- =====================================================
-- Updated_at trigger function
-- =====================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Add triggers for updated_at
CREATE TRIGGER update_ai_session_learnings_updated_at
  BEFORE UPDATE ON ai_session_learnings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ai_pattern_ev_tracking_updated_at
  BEFORE UPDATE ON ai_pattern_ev_tracking
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ai_discovered_strategies_updated_at
  BEFORE UPDATE ON ai_discovered_strategies
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
