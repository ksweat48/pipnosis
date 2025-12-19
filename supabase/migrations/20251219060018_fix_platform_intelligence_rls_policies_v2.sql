/*
  # Fix Platform Intelligence RLS Policies - Allow Service Role Writes

  1. Changes
    - Add service_role INSERT/UPDATE/DELETE policies to platform intelligence tables
    - Create backfill function to mark existing trade analyses
    - Add indexes for performance
    - Initialize today's platform stats record

  2. Tables Updated
    - ai_global_patterns
    - ai_global_symbol_intelligence
    - ai_global_market_scenarios
    - ai_global_setup_library
    - ai_platform_learning_stats

  3. Security
    - Service role can write to platform tables (required for ai-learning-engine.ts)
    - Authenticated users can still only read (existing policies preserved)
*/

-- ============================================================
-- PART 1: Add service_role write policies to platform tables
-- ============================================================

-- ai_global_patterns
DROP POLICY IF EXISTS "Service can write global patterns" ON ai_global_patterns;
CREATE POLICY "Service can write global patterns"
  ON ai_global_patterns
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ai_global_symbol_intelligence
DROP POLICY IF EXISTS "Service can write global symbol intelligence" ON ai_global_symbol_intelligence;
CREATE POLICY "Service can write global symbol intelligence"
  ON ai_global_symbol_intelligence
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ai_global_market_scenarios
DROP POLICY IF EXISTS "Service can write global market scenarios" ON ai_global_market_scenarios;
CREATE POLICY "Service can write global market scenarios"
  ON ai_global_market_scenarios
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ai_global_setup_library
DROP POLICY IF EXISTS "Service can write global setup library" ON ai_global_setup_library;
CREATE POLICY "Service can write global setup library"
  ON ai_global_setup_library
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ai_platform_learning_stats
DROP POLICY IF EXISTS "Service can write platform stats" ON ai_platform_learning_stats;
CREATE POLICY "Service can write platform stats"
  ON ai_platform_learning_stats
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- PART 2: Create backfill function for existing trade analyses
-- ============================================================

CREATE OR REPLACE FUNCTION backfill_platform_contribution_flags()
RETURNS TABLE(updated_count bigint) AS $$
DECLARE
  v_updated_count bigint;
BEGIN
  -- Update existing ai_trade_analysis records to mark them for platform contribution
  UPDATE ai_trade_analysis
  SET contributed_to_global_learning = true
  WHERE contributed_to_learning = true
    AND (contributed_to_global_learning IS NULL OR contributed_to_global_learning = false);
  
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  
  RETURN QUERY SELECT v_updated_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- PART 3: Add performance indexes
-- ============================================================

-- Index for pattern lookups by pattern_id
CREATE INDEX IF NOT EXISTS idx_ai_global_patterns_pattern_id 
  ON ai_global_patterns(pattern_id);

-- Index for symbol intelligence lookups
CREATE INDEX IF NOT EXISTS idx_ai_global_symbol_intelligence_symbol 
  ON ai_global_symbol_intelligence(symbol);

-- Index for platform stats by date
CREATE INDEX IF NOT EXISTS idx_ai_platform_learning_stats_date 
  ON ai_platform_learning_stats(stat_date DESC);

-- Index for market scenario lookups
CREATE INDEX IF NOT EXISTS idx_ai_global_market_scenarios_scenario_id 
  ON ai_global_market_scenarios(scenario_id);

-- ============================================================
-- PART 4: Initialize today's platform stats record if missing
-- ============================================================

INSERT INTO ai_platform_learning_stats (
  stat_date,
  trades_analyzed_today,
  patterns_discovered_today,
  patterns_validated_today,
  unique_users_contributing,
  total_trades_analyzed,
  total_patterns_discovered,
  total_symbols_tracked,
  platform_win_rate,
  platform_profit_factor,
  intelligence_growth_rate,
  best_symbol_today,
  best_pattern_today,
  best_win_rate_today
)
VALUES (
  CURRENT_DATE,
  0, -- trades_analyzed_today
  0, -- patterns_discovered_today
  0, -- patterns_validated_today
  0, -- unique_users_contributing
  0, -- total_trades_analyzed
  0, -- total_patterns_discovered
  0, -- total_symbols_tracked
  0.0, -- platform_win_rate
  0.0, -- platform_profit_factor
  0.0, -- intelligence_growth_rate
  NULL, -- best_symbol_today
  NULL, -- best_pattern_today
  0.0 -- best_win_rate_today
)
ON CONFLICT (stat_date) DO NOTHING;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'Platform Intelligence RLS policies added successfully';
  RAISE NOTICE 'Tables updated: ai_global_patterns, ai_global_symbol_intelligence, ai_global_market_scenarios, ai_global_setup_library, ai_platform_learning_stats';
  RAISE NOTICE 'Run: SELECT backfill_platform_contribution_flags(); to update existing trade analyses';
END $$;
