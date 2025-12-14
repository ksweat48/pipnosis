/*
  # Create Platform-Wide AI Learning System

  1. New Tables (NO user_id, NO RLS - Collective Intelligence)
    - ai_global_patterns
    - ai_global_market_scenarios
    - ai_global_symbol_intelligence
    - ai_global_setup_library
    - ai_global_confidence_calibration
    - ai_platform_learning_stats

  2. Modified Tables
    - Add `contributed_to_global_learning` flag to ai_trade_analysis

  3. Security
    - Global tables readable by all authenticated users
    - Write access only through backend services
*/

-- ============================================================================
-- ai_global_patterns - Platform-wide pattern performance
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_global_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_id text NOT NULL UNIQUE,
  pattern_name text NOT NULL,
  symbol text NOT NULL,
  setup_type text NOT NULL,
  direction text CHECK (direction IN ('buy', 'sell', 'both')),
  total_occurrences int DEFAULT 0,
  win_count int DEFAULT 0,
  loss_count int DEFAULT 0,
  breakeven_count int DEFAULT 0,
  win_rate numeric DEFAULT 0,
  profit_factor numeric DEFAULT 0,
  avg_rr numeric DEFAULT 0,
  market_conditions jsonb DEFAULT '{}'::jsonb,
  volatility_regime text DEFAULT 'medium',
  trend_direction text,
  optimal_timeframes text[],
  last_occurrence_at timestamptz,
  discovery_date timestamptz DEFAULT now(),
  decay_weight numeric DEFAULT 1.0,
  sample_size_adequate boolean DEFAULT false,
  statistical_significance numeric DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_global_patterns_symbol ON ai_global_patterns(symbol);
CREATE INDEX IF NOT EXISTS idx_global_patterns_setup ON ai_global_patterns(setup_type);
CREATE INDEX IF NOT EXISTS idx_global_patterns_win_rate ON ai_global_patterns(win_rate DESC);
CREATE INDEX IF NOT EXISTS idx_global_patterns_freshness ON ai_global_patterns(last_occurrence_at DESC);

-- ============================================================================
-- ai_global_market_scenarios
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_global_market_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id text NOT NULL UNIQUE,
  symbol text NOT NULL,
  market_type text NOT NULL,
  volatility_regime text NOT NULL,
  trend_strength text,
  total_trades int DEFAULT 0,
  trades_won int DEFAULT 0,
  trades_lost int DEFAULT 0,
  win_rate numeric DEFAULT 0,
  avg_profit_per_trade numeric DEFAULT 0,
  profit_factor numeric DEFAULT 0,
  top_patterns text[],
  recommended_confidence_threshold numeric DEFAULT 75,
  sample_size_sufficient boolean DEFAULT false,
  last_updated timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_global_scenarios_symbol ON ai_global_market_scenarios(symbol);
CREATE INDEX IF NOT EXISTS idx_global_scenarios_type ON ai_global_market_scenarios(market_type);
CREATE INDEX IF NOT EXISTS idx_global_scenarios_win_rate ON ai_global_market_scenarios(win_rate DESC);

-- ============================================================================
-- ai_global_symbol_intelligence
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_global_symbol_intelligence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL UNIQUE,
  total_trades_platform_wide int DEFAULT 0,
  platform_win_rate numeric DEFAULT 0,
  platform_profit_factor numeric DEFAULT 0,
  best_timeframes text[],
  best_session_times text[],
  best_volatility_regime text,
  best_trend_direction text,
  top_winning_patterns jsonb DEFAULT '[]'::jsonb,
  top_losing_patterns jsonb DEFAULT '[]'::jsonb,
  last_pattern_discovered_at timestamptz,
  intelligence_quality_score numeric DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_global_symbol_intel_symbol ON ai_global_symbol_intelligence(symbol);
CREATE INDEX IF NOT EXISTS idx_global_symbol_intel_quality ON ai_global_symbol_intelligence(intelligence_quality_score DESC);

-- ============================================================================
-- ai_global_setup_library
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_global_setup_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setup_id text NOT NULL UNIQUE,
  setup_name text NOT NULL,
  setup_description text,
  setup_category text,
  win_rate numeric DEFAULT 0,
  profit_factor numeric DEFAULT 0,
  avg_rr numeric DEFAULT 0,
  sample_size int DEFAULT 0,
  required_market_conditions jsonb DEFAULT '{}'::jsonb,
  required_indicators jsonb DEFAULT '{}'::jsonb,
  optimal_symbols text[],
  first_discovered_at timestamptz DEFAULT now(),
  times_validated int DEFAULT 0,
  validation_score numeric DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_global_setups_win_rate ON ai_global_setup_library(win_rate DESC);
CREATE INDEX IF NOT EXISTS idx_global_setups_validation ON ai_global_setup_library(validation_score DESC);
CREATE INDEX IF NOT EXISTS idx_global_setups_category ON ai_global_setup_library(setup_category);

-- ============================================================================
-- ai_platform_learning_stats
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_platform_learning_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stat_date date NOT NULL UNIQUE,
  trades_analyzed_today int DEFAULT 0,
  patterns_discovered_today int DEFAULT 0,
  patterns_validated_today int DEFAULT 0,
  unique_users_contributing int DEFAULT 0,
  total_trades_analyzed int DEFAULT 0,
  total_patterns_discovered int DEFAULT 0,
  total_symbols_tracked int DEFAULT 0,
  platform_win_rate numeric DEFAULT 0,
  platform_profit_factor numeric DEFAULT 0,
  intelligence_growth_rate numeric DEFAULT 0,
  best_symbol_today text,
  best_pattern_today text,
  best_win_rate_today numeric DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_stats_date ON ai_platform_learning_stats(stat_date DESC);

-- ============================================================================
-- Add contributed_to_global_learning to ai_trade_analysis
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_trade_analysis' AND column_name = 'contributed_to_global_learning'
  ) THEN
    ALTER TABLE ai_trade_analysis ADD COLUMN contributed_to_global_learning boolean DEFAULT false;
    CREATE INDEX idx_trade_analysis_global_contribution ON ai_trade_analysis(contributed_to_global_learning);
  END IF;
END $$;

-- ============================================================================
-- RLS POLICIES - Global tables readable by all authenticated users
-- ============================================================================

ALTER TABLE ai_global_patterns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read global patterns" ON ai_global_patterns;
CREATE POLICY "Anyone can read global patterns"
  ON ai_global_patterns FOR SELECT
  TO authenticated
  USING (true);

ALTER TABLE ai_global_market_scenarios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read global market scenarios" ON ai_global_market_scenarios;
CREATE POLICY "Anyone can read global market scenarios"
  ON ai_global_market_scenarios FOR SELECT
  TO authenticated
  USING (true);

ALTER TABLE ai_global_symbol_intelligence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read global symbol intelligence" ON ai_global_symbol_intelligence;
CREATE POLICY "Anyone can read global symbol intelligence"
  ON ai_global_symbol_intelligence FOR SELECT
  TO authenticated
  USING (true);

ALTER TABLE ai_global_setup_library ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read global setup library" ON ai_global_setup_library;
CREATE POLICY "Anyone can read global setup library"
  ON ai_global_setup_library FOR SELECT
  TO authenticated
  USING (true);

ALTER TABLE ai_platform_learning_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read platform stats" ON ai_platform_learning_stats;
CREATE POLICY "Anyone can read platform stats"
  ON ai_platform_learning_stats FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================================
-- Helper functions
-- ============================================================================

CREATE OR REPLACE FUNCTION initialize_daily_platform_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO ai_platform_learning_stats (stat_date)
  VALUES (CURRENT_DATE)
  ON CONFLICT (stat_date) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION update_platform_learning_stats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM initialize_daily_platform_stats();
  
  UPDATE ai_platform_learning_stats
  SET
    trades_analyzed_today = trades_analyzed_today + 1,
    total_trades_analyzed = total_trades_analyzed + 1,
    updated_at = now()
  WHERE stat_date = CURRENT_DATE;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_platform_stats_on_trade_analysis ON ai_trade_analysis;
CREATE TRIGGER update_platform_stats_on_trade_analysis
  AFTER INSERT ON ai_trade_analysis
  FOR EACH ROW
  EXECUTE FUNCTION update_platform_learning_stats();