/*
  ═══════════════════════════════════════════════════════════════════════════
  AI LEARNING INFRASTRUCTURE - CCIP Compliance
  ═══════════════════════════════════════════════════════════════════════════

  ## Problem
  AI learning system references 4 tables that don't exist, causing:
  - 400/404 errors on every trade closure
  - AI cannot learn from trades
  - No AI insights displayed to users
  - 10+ service files broken

  ## Solution
  Create complete AI learning infrastructure with SSOT compliance:
  1. ai_trade_analysis - Detailed trade analysis (SSOT for trade learning)
  2. ai_market_scenario_performance - Scenario-based performance (SSOT for aggregates)
  3. trade_learning_log - Event log of learning activities (immutable audit trail)
  4. ai_global_confidence_calibration - Platform-wide calibration (shared intelligence)

  ## SSOT Principles
  - ai_trade_analysis is authoritative source for trade learning data
  - ai_market_scenario_performance is authoritative source for aggregated metrics
  - trade_learning_log is append-only event log (no updates)
  - ai_global_confidence_calibration is shared across all users

  ## Security
  - RLS enabled on all tables
  - Users can only access own data (except global calibration)
  - Service role has full access for system operations
  - Proper indexes for query performance

  ═══════════════════════════════════════════════════════════════════════════
*/

-- ============================================================================
-- TABLE 1: ai_trade_analysis - Detailed Trade Learning Data (SSOT)
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_trade_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  live_trade_id uuid REFERENCES goal_session_trades(id) ON DELETE SET NULL,
  symbol text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('buy', 'sell')),
  outcome text NOT NULL CHECK (outcome IN ('win', 'loss', 'breakeven')),
  pnl numeric NOT NULL DEFAULT 0,
  entry_time timestamptz NOT NULL,
  exit_time timestamptz,
  duration_minutes integer,
  entry_confidence numeric CHECK (entry_confidence >= 0 AND entry_confidence <= 100),
  actual_win_rate numeric,
  matching_historical_patterns jsonb DEFAULT '[]'::jsonb,
  lesson_learned text,
  key_learnings jsonb DEFAULT '[]'::jsonb,
  mistakes jsonb DEFAULT '[]'::jsonb,
  what_worked jsonb DEFAULT '[]'::jsonb,
  what_failed jsonb DEFAULT '[]'::jsonb,
  volatility_regime text,
  market_conditions jsonb DEFAULT '{}'::jsonb,
  contributed_to_global_learning boolean DEFAULT false,
  reasoning text,
  analyzed_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE ai_trade_analysis ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own trade analysis" ON ai_trade_analysis;
CREATE POLICY "Users can read own trade analysis"
  ON ai_trade_analysis FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own trade analysis" ON ai_trade_analysis;
CREATE POLICY "Users can insert own trade analysis"
  ON ai_trade_analysis FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own trade analysis" ON ai_trade_analysis;
CREATE POLICY "Users can update own trade analysis"
  ON ai_trade_analysis FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role full access to trade analysis" ON ai_trade_analysis;
CREATE POLICY "Service role full access to trade analysis"
  ON ai_trade_analysis FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_ai_trade_analysis_user_symbol ON ai_trade_analysis(user_id, symbol);
CREATE INDEX IF NOT EXISTS idx_ai_trade_analysis_user_outcome ON ai_trade_analysis(user_id, outcome);
CREATE INDEX IF NOT EXISTS idx_ai_trade_analysis_live_trade ON ai_trade_analysis(live_trade_id) WHERE live_trade_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_trade_analysis_patterns ON ai_trade_analysis USING GIN (matching_historical_patterns);

-- ============================================================================
-- TABLE 2: ai_market_scenario_performance - Scenario Aggregates (SSOT)
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_market_scenario_performance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scenario_name text NOT NULL,
  market_type text NOT NULL,
  symbol text NOT NULL,
  timeframe text NOT NULL,
  total_occurrences integer DEFAULT 0,
  trades_taken integer DEFAULT 0,
  trades_won integer DEFAULT 0,
  trades_lost integer DEFAULT 0,
  win_rate numeric DEFAULT 0,
  avg_pnl_per_trade numeric DEFAULT 0,
  total_pnl numeric DEFAULT 0,
  last_updated timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, scenario_name, symbol, timeframe)
);

ALTER TABLE ai_market_scenario_performance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own scenario performance" ON ai_market_scenario_performance;
CREATE POLICY "Users can read own scenario performance"
  ON ai_market_scenario_performance FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own scenario performance" ON ai_market_scenario_performance;
CREATE POLICY "Users can insert own scenario performance"
  ON ai_market_scenario_performance FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own scenario performance" ON ai_market_scenario_performance;
CREATE POLICY "Users can update own scenario performance"
  ON ai_market_scenario_performance FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role full access to scenario performance" ON ai_market_scenario_performance;
CREATE POLICY "Service role full access to scenario performance"
  ON ai_market_scenario_performance FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_ai_scenario_user_symbol ON ai_market_scenario_performance(user_id, symbol);
CREATE INDEX IF NOT EXISTS idx_ai_scenario_user_scenario ON ai_market_scenario_performance(user_id, scenario_name);

-- ============================================================================
-- TABLE 3: trade_learning_log - Event Log (Immutable Audit Trail)
-- ============================================================================

CREATE TABLE IF NOT EXISTS trade_learning_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trade_id uuid REFERENCES goal_session_trades(id) ON DELETE SET NULL,
  symbol text NOT NULL,
  position_type text NOT NULL CHECK (position_type IN ('buy', 'sell')),
  outcome text NOT NULL CHECK (outcome IN ('win', 'loss', 'breakeven')),
  pnl numeric NOT NULL DEFAULT 0,
  insights_extracted_count integer DEFAULT 0,
  live_trade_weight numeric DEFAULT 2.0,
  risk_multiplier numeric DEFAULT 1.0,
  learning_contribution numeric DEFAULT 0,
  patterns_identified jsonb DEFAULT '[]'::jsonb,
  lessons_extracted jsonb DEFAULT '[]'::jsonb,
  logged_at timestamptz DEFAULT now()
);

ALTER TABLE trade_learning_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own learning log" ON trade_learning_log;
CREATE POLICY "Users can read own learning log"
  ON trade_learning_log FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own learning log" ON trade_learning_log;
CREATE POLICY "Users can insert own learning log"
  ON trade_learning_log FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role full access to learning log" ON trade_learning_log;
CREATE POLICY "Service role full access to learning log"
  ON trade_learning_log FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_trade_learning_log_user ON trade_learning_log(user_id);
CREATE INDEX IF NOT EXISTS idx_trade_learning_log_trade ON trade_learning_log(trade_id) WHERE trade_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trade_learning_log_patterns ON trade_learning_log USING GIN (patterns_identified);

-- ============================================================================
-- TABLE 4: ai_global_confidence_calibration - Platform Intelligence (Shared)
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_global_confidence_calibration (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  confidence_bucket text NOT NULL UNIQUE,
  total_predictions integer DEFAULT 0,
  correct_predictions integer DEFAULT 0,
  actual_win_rate numeric DEFAULT 0,
  calibration_error numeric DEFAULT 0,
  last_updated timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE ai_global_confidence_calibration ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read global calibration" ON ai_global_confidence_calibration;
CREATE POLICY "Authenticated users can read global calibration"
  ON ai_global_confidence_calibration FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role can insert global calibration" ON ai_global_confidence_calibration;
CREATE POLICY "Service role can insert global calibration"
  ON ai_global_confidence_calibration FOR INSERT TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can update global calibration" ON ai_global_confidence_calibration;
CREATE POLICY "Service role can update global calibration"
  ON ai_global_confidence_calibration FOR UPDATE TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_global_calibration_bucket ON ai_global_confidence_calibration(confidence_bucket);

-- Initialize confidence buckets
INSERT INTO ai_global_confidence_calibration (confidence_bucket, total_predictions, correct_predictions, actual_win_rate, calibration_error)
VALUES
  ('50-55', 0, 0, 0, 0), ('55-60', 0, 0, 0, 0), ('60-65', 0, 0, 0, 0),
  ('65-70', 0, 0, 0, 0), ('70-75', 0, 0, 0, 0), ('75-80', 0, 0, 0, 0),
  ('80-85', 0, 0, 0, 0), ('85-90', 0, 0, 0, 0), ('90-95', 0, 0, 0, 0),
  ('95-100', 0, 0, 0, 0)
ON CONFLICT (confidence_bucket) DO NOTHING;
