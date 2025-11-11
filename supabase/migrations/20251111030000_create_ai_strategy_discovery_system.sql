/*
  # AI Strategy Discovery and Evolution System

  1. New Tables
    - `ai_discovered_strategies` - Stores AI-created trading strategies
    - `strategy_parameter_evolution` - Tracks parameter optimization history
    - `strategy_validation_results` - Stores backtest results for strategy validation
    - `strategy_selection_log` - Records strategy selection decisions
    - `market_regime_detector` - Stores detected market regimes over time
    - `strategy_creation_log` - Tracks when and how strategies are discovered
    - `strategy_dna` - Stores strategy genetic encoding for evolution

  2. Enhanced Tables
    - Add additional columns to `strategy_performance` for regime-specific metrics

  3. Views
    - `strategy_arsenal_view` - Ranked view of all strategies by performance
    - `active_strategies_view` - Currently active strategies meeting performance thresholds

  4. Security
    - Enable RLS on all new tables
    - Add policies for authenticated users
*/

-- AI Discovered Strategies Table
-- Stores complete definitions of AI-created trading strategies
CREATE TABLE IF NOT EXISTS ai_discovered_strategies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  strategy_name text NOT NULL,
  strategy_type text NOT NULL, -- 'discovered', 'evolved', 'hybrid'
  parent_strategy_id uuid REFERENCES ai_discovered_strategies(id) ON DELETE SET NULL,
  generation integer DEFAULT 1 NOT NULL,

  -- Strategy Definition (executable parameters)
  entry_rules jsonb NOT NULL, -- Complete entry logic
  exit_rules jsonb NOT NULL, -- Complete exit logic
  indicators jsonb NOT NULL, -- All indicators with parameters
  timeframes text[] NOT NULL, -- Required timeframes

  -- Strategy DNA (for evolution)
  dna_encoding jsonb NOT NULL, -- Genetic representation of parameters
  mutation_count integer DEFAULT 0,
  crossover_parent_ids uuid[],

  -- Performance Metrics
  total_trades integer DEFAULT 0,
  winning_trades integer DEFAULT 0,
  losing_trades integer DEFAULT 0,
  win_rate numeric DEFAULT 0,
  profit_factor numeric DEFAULT 0,
  avg_risk_reward numeric DEFAULT 0,
  expectancy numeric DEFAULT 0,
  sharpe_ratio numeric DEFAULT 0,
  max_drawdown_percent numeric DEFAULT 0,

  -- Validation Status
  validation_status text DEFAULT 'pending' NOT NULL, -- 'pending', 'validated', 'failed', 'active', 'archived'
  validation_date timestamptz,
  passes_baseline boolean DEFAULT false, -- Better than Flow Trader V2
  baseline_comparison jsonb, -- Detailed comparison metrics

  -- Market Regime Performance
  trending_up_win_rate numeric DEFAULT 0,
  trending_down_win_rate numeric DEFAULT 0,
  ranging_win_rate numeric DEFAULT 0,
  high_volatility_win_rate numeric DEFAULT 0,
  low_volatility_win_rate numeric DEFAULT 0,

  -- Metadata
  discovery_method text, -- 'pattern_clustering', 'parameter_evolution', 'ensemble', 'mutation'
  discovery_insights text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  last_used_at timestamptz,

  -- Constraints
  UNIQUE(user_id, strategy_name)
);

CREATE INDEX IF NOT EXISTS idx_ai_strategies_user ON ai_discovered_strategies(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_strategies_status ON ai_discovered_strategies(validation_status);
CREATE INDEX IF NOT EXISTS idx_ai_strategies_win_rate ON ai_discovered_strategies(win_rate DESC);
CREATE INDEX IF NOT EXISTS idx_ai_strategies_expectancy ON ai_discovered_strategies(expectancy DESC);
CREATE INDEX IF NOT EXISTS idx_ai_strategies_passes_baseline ON ai_discovered_strategies(passes_baseline);
CREATE INDEX IF NOT EXISTS idx_ai_strategies_generation ON ai_discovered_strategies(generation);

ALTER TABLE ai_discovered_strategies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own discovered strategies"
  ON ai_discovered_strategies FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own discovered strategies"
  ON ai_discovered_strategies FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own discovered strategies"
  ON ai_discovered_strategies FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own discovered strategies"
  ON ai_discovered_strategies FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());


-- Strategy Parameter Evolution Table
-- Tracks how strategy parameters evolve and improve over time
CREATE TABLE IF NOT EXISTS strategy_parameter_evolution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  strategy_id uuid REFERENCES ai_discovered_strategies(id) ON DELETE CASCADE NOT NULL,

  -- Evolution Details
  evolution_type text NOT NULL, -- 'mutation', 'crossover', 'optimization', 'manual'
  parameter_name text NOT NULL,
  old_value jsonb,
  new_value jsonb NOT NULL,

  -- Performance Impact
  performance_before jsonb,
  performance_after jsonb,
  improvement_delta numeric, -- Positive = better, negative = worse

  -- Context
  market_regime text,
  sample_size integer,
  confidence_level numeric,

  -- Metadata
  evolution_reason text,
  applied_at timestamptz DEFAULT now() NOT NULL,
  reverted_at timestamptz,
  revert_reason text
);

CREATE INDEX IF NOT EXISTS idx_param_evolution_strategy ON strategy_parameter_evolution(strategy_id);
CREATE INDEX IF NOT EXISTS idx_param_evolution_user ON strategy_parameter_evolution(user_id);
CREATE INDEX IF NOT EXISTS idx_param_evolution_applied ON strategy_parameter_evolution(applied_at DESC);

ALTER TABLE strategy_parameter_evolution ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own parameter evolution"
  ON strategy_parameter_evolution FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own parameter evolution"
  ON strategy_parameter_evolution FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());


-- Strategy Validation Results Table
-- Stores backtest results for validating new strategies
CREATE TABLE IF NOT EXISTS strategy_validation_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  strategy_id uuid REFERENCES ai_discovered_strategies(id) ON DELETE CASCADE NOT NULL,

  -- Validation Run Details
  validation_type text NOT NULL, -- 'initial', 'revalidation', 'cross_validation', 'walk_forward'
  backtest_session_id uuid,
  synthetic_session_id uuid,

  -- Date Range
  start_date timestamptz NOT NULL,
  end_date timestamptz NOT NULL,
  symbols text[] NOT NULL,

  -- Results
  total_trades integer DEFAULT 0,
  winning_trades integer DEFAULT 0,
  win_rate numeric DEFAULT 0,
  profit_factor numeric DEFAULT 0,
  sharpe_ratio numeric DEFAULT 0,
  max_drawdown_percent numeric DEFAULT 0,
  expectancy numeric DEFAULT 0,

  -- Comparison to Baseline
  baseline_strategy text DEFAULT 'Flow Trader V2',
  baseline_win_rate numeric,
  baseline_profit_factor numeric,
  beats_baseline boolean DEFAULT false,
  performance_delta numeric, -- How much better (or worse)

  -- Statistical Validation
  sample_size_sufficient boolean DEFAULT false,
  statistical_significance numeric, -- p-value
  overfitting_detected boolean DEFAULT false,

  -- Pass/Fail
  passed boolean DEFAULT false,
  fail_reasons text[],

  -- Metadata
  validated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_validation_strategy ON strategy_validation_results(strategy_id);
CREATE INDEX IF NOT EXISTS idx_validation_user ON strategy_validation_results(user_id);
CREATE INDEX IF NOT EXISTS idx_validation_passed ON strategy_validation_results(passed);
CREATE INDEX IF NOT EXISTS idx_validation_date ON strategy_validation_results(validated_at DESC);

ALTER TABLE strategy_validation_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own validation results"
  ON strategy_validation_results FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own validation results"
  ON strategy_validation_results FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());


-- Strategy Selection Log Table
-- Records which strategy was selected and why
CREATE TABLE IF NOT EXISTS strategy_selection_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  goal_session_id uuid,
  backtest_session_id uuid,

  -- Selection Details
  selected_strategy_id uuid REFERENCES ai_discovered_strategies(id) ON DELETE SET NULL,
  selected_strategy_name text NOT NULL,
  selection_reason text NOT NULL,

  -- Market Context
  market_regime jsonb NOT NULL,
  current_volatility text,
  trend_direction text,
  time_of_day text,

  -- Decision Factors
  strategy_confidence numeric, -- How confident in this strategy choice
  performance_in_regime numeric, -- Historical win rate in this regime
  alternatives_considered jsonb, -- Other strategies considered

  -- Outcome (filled after trade execution)
  trade_id uuid,
  trade_outcome text, -- 'win', 'loss', 'breakeven'
  was_good_selection boolean, -- Did strategy perform as expected

  -- Metadata
  selected_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_selection_log_strategy ON strategy_selection_log(selected_strategy_id);
CREATE INDEX IF NOT EXISTS idx_selection_log_user ON strategy_selection_log(user_id);
CREATE INDEX IF NOT EXISTS idx_selection_log_session ON strategy_selection_log(goal_session_id);
CREATE INDEX IF NOT EXISTS idx_selection_log_date ON strategy_selection_log(selected_at DESC);

ALTER TABLE strategy_selection_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own selection logs"
  ON strategy_selection_log FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own selection logs"
  ON strategy_selection_log FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own selection logs"
  ON strategy_selection_log FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- Market Regime Detector Table
-- Stores detected market regimes over time for pattern analysis
CREATE TABLE IF NOT EXISTS market_regime_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  symbol text NOT NULL,
  timeframe text NOT NULL,

  -- Regime Classification
  regime_type text NOT NULL, -- 'trending_up', 'trending_down', 'ranging', 'mixed'
  volatility_level text NOT NULL, -- 'low', 'medium', 'high', 'extreme'
  trend_strength numeric, -- 0-100

  -- Technical Metrics
  atr numeric,
  atr_percentile numeric, -- Where current ATR ranks historically
  adx numeric,
  price_location text, -- 'near_high', 'near_low', 'middle'

  -- Volume Analysis
  volume_trend text, -- 'increasing', 'decreasing', 'stable'
  liquidity_level text, -- 'high', 'medium', 'low'

  -- Time Context
  session_type text, -- 'asian', 'london', 'newyork', 'overlap'

  -- Duration
  regime_start timestamptz NOT NULL,
  regime_end timestamptz,
  duration_minutes integer,

  -- Metadata
  detected_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_regime_history_symbol ON market_regime_history(symbol);
CREATE INDEX IF NOT EXISTS idx_regime_history_user ON market_regime_history(user_id);
CREATE INDEX IF NOT EXISTS idx_regime_history_regime ON market_regime_history(regime_type);
CREATE INDEX IF NOT EXISTS idx_regime_history_detected ON market_regime_history(detected_at DESC);

ALTER TABLE market_regime_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own regime history"
  ON market_regime_history FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own regime history"
  ON market_regime_history FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());


-- Strategy Creation Log Table
-- Tracks when and how new strategies are discovered
CREATE TABLE IF NOT EXISTS strategy_creation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  strategy_id uuid REFERENCES ai_discovered_strategies(id) ON DELETE CASCADE NOT NULL,

  -- Creation Details
  creation_method text NOT NULL, -- 'pattern_discovery', 'evolution', 'mutation', 'crossover'
  trigger_reason text NOT NULL,

  -- Source Data
  source_trades_analyzed integer,
  winning_patterns_found integer,
  pattern_confidence numeric,

  -- Parent Information
  parent_strategies uuid[],
  inherited_traits text[],

  -- Initial Performance Estimate
  estimated_win_rate numeric,
  estimated_profit_factor numeric,
  confidence_in_estimate numeric,

  -- Metadata
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_creation_log_strategy ON strategy_creation_log(strategy_id);
CREATE INDEX IF NOT EXISTS idx_creation_log_user ON strategy_creation_log(user_id);
CREATE INDEX IF NOT EXISTS idx_creation_log_date ON strategy_creation_log(created_at DESC);

ALTER TABLE strategy_creation_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own creation logs"
  ON strategy_creation_log FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own creation logs"
  ON strategy_creation_log FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());


-- Enhance existing strategy_performance table
DO $$
BEGIN
  -- Add regime-specific performance columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'strategy_performance' AND column_name = 'regime_performance') THEN
    ALTER TABLE strategy_performance ADD COLUMN regime_performance jsonb DEFAULT '{}'::jsonb;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'strategy_performance' AND column_name = 'is_ai_discovered') THEN
    ALTER TABLE strategy_performance ADD COLUMN is_ai_discovered boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'strategy_performance' AND column_name = 'strategy_id') THEN
    ALTER TABLE strategy_performance ADD COLUMN strategy_id uuid REFERENCES ai_discovered_strategies(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'strategy_performance' AND column_name = 'beats_baseline') THEN
    ALTER TABLE strategy_performance ADD COLUMN beats_baseline boolean DEFAULT false;
  END IF;
END $$;


-- Create Strategy Arsenal View
-- Shows all strategies ranked by performance
CREATE OR REPLACE VIEW strategy_arsenal_view AS
SELECT
  s.id,
  s.user_id,
  s.strategy_name,
  s.strategy_type,
  s.generation,
  s.win_rate,
  s.profit_factor,
  s.expectancy,
  s.sharpe_ratio,
  s.total_trades,
  s.validation_status,
  s.passes_baseline,
  s.baseline_comparison,
  s.discovery_method,
  s.created_at,
  s.last_used_at,

  -- Performance Rank
  RANK() OVER (PARTITION BY s.user_id ORDER BY s.expectancy DESC) as expectancy_rank,
  RANK() OVER (PARTITION BY s.user_id ORDER BY s.win_rate DESC) as win_rate_rank,
  RANK() OVER (PARTITION BY s.user_id ORDER BY s.profit_factor DESC) as profit_factor_rank,

  -- Composite Score (weighted average of key metrics)
  (s.win_rate * 0.3 + s.profit_factor * 20 + s.expectancy * 50) as composite_score,

  -- Regime-specific metrics
  s.trending_up_win_rate,
  s.trending_down_win_rate,
  s.ranging_win_rate,
  s.high_volatility_win_rate,
  s.low_volatility_win_rate,

  -- Validation info
  (SELECT COUNT(*) FROM strategy_validation_results v WHERE v.strategy_id = s.id AND v.passed = true) as validation_passes,
  (SELECT COUNT(*) FROM strategy_validation_results v WHERE v.strategy_id = s.id) as total_validations

FROM ai_discovered_strategies s
WHERE s.validation_status IN ('validated', 'active')
ORDER BY composite_score DESC;


-- Create Active Strategies View
-- Only shows strategies currently meeting performance thresholds
CREATE OR REPLACE VIEW active_strategies_view AS
SELECT *
FROM strategy_arsenal_view
WHERE
  validation_status = 'active'
  AND passes_baseline = true
  AND win_rate >= 55
  AND profit_factor >= 1.5
  AND total_trades >= 10
ORDER BY composite_score DESC;


-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_ai_discovered_strategies_updated_at
  BEFORE UPDATE ON ai_discovered_strategies
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
