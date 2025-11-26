/*
  # Complete AI Learning Reset - Fresh Start After Position Sizing Bug Fix

  1. Purpose
    - Remove ALL corrupted backtest data from position sizing bug
    - Reset AI learning metrics to baseline
    - Clear all pattern discoveries, skill progressions, and learnings
    - Provide clean slate for accurate learning with fixed position sizing

  2. Safety
    - Uses IF EXISTS checks to avoid errors
    - Only deletes from existing tables
    - Preserves user accounts and price data
*/

-- ============================================================
-- HELPER FUNCTION: Safe Delete
-- ============================================================

CREATE OR REPLACE FUNCTION safe_delete_all(table_name text)
RETURNS void AS $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = table_name) THEN
    EXECUTE format('DELETE FROM %I', table_name);
    RAISE NOTICE '✓ Cleared table: %', table_name;
  ELSE
    RAISE NOTICE '⊘ Table does not exist: %', table_name;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- SECTION 1: BACKTEST DATA
-- ============================================================

SELECT safe_delete_all('synthetic_backtest_trades');
SELECT safe_delete_all('synthetic_backtest_sessions');
SELECT safe_delete_all('backtest_progress_tracking');
SELECT safe_delete_all('synthetic_data_generations');

-- ============================================================
-- SECTION 2: AI LEARNING & PATTERNS
-- ============================================================

SELECT safe_delete_all('ai_pattern_discoveries');
SELECT safe_delete_all('ai_pattern_interpretations');
SELECT safe_delete_all('ai_pattern_graduations');
SELECT safe_delete_all('ai_pattern_ev_tracking');
SELECT safe_delete_all('cross_symbol_pattern_clusters');
SELECT safe_delete_all('ai_strategy_discoveries');

-- ============================================================
-- SECTION 3: SKILL PROGRESSION
-- ============================================================

SELECT safe_delete_all('ai_skill_progression');
SELECT safe_delete_all('spc_session_scores');
SELECT safe_delete_all('session_milestones');
SELECT safe_delete_all('skill_mastery_curve');
SELECT safe_delete_all('skill_aware_recommendations');

-- ============================================================
-- SECTION 4: LEARNING & THOUGHT PROCESSES
-- ============================================================

SELECT safe_delete_all('ai_thought_stream');
SELECT safe_delete_all('session_learnings');
SELECT safe_delete_all('daily_learnings');
SELECT safe_delete_all('meta_learning_insights');
SELECT safe_delete_all('trade_learning_log');
SELECT safe_delete_all('learning_pipeline_health');

-- ============================================================
-- SECTION 5: PERFORMANCE METRICS & KPIs
-- ============================================================

SELECT safe_delete_all('daily_session_results');
SELECT safe_delete_all('kpi_snapshots');
SELECT safe_delete_all('kpi_historical_data');
SELECT safe_delete_all('ai_performance_evolution');
SELECT safe_delete_all('plateau_detection_log');
SELECT safe_delete_all('breakthrough_attempts');

-- ============================================================
-- SECTION 6: RECOMMENDATIONS & TRACKING
-- ============================================================

SELECT safe_delete_all('recommendation_tracking');
SELECT safe_delete_all('recommendation_implementation_log');
SELECT safe_delete_all('avoid_pattern_enforcement_log');
SELECT safe_delete_all('dynamic_avoid_list');

-- ============================================================
-- SECTION 7: CONFIDENCE & CALIBRATION
-- ============================================================

SELECT safe_delete_all('confidence_tracking');
SELECT safe_delete_all('confidence_calibration');
SELECT safe_delete_all('llm_decision_quality');

-- ============================================================
-- SECTION 8: GPT-4o USAGE & COSTS
-- ============================================================

SELECT safe_delete_all('gpt4o_usage_tracking');
SELECT safe_delete_all('gpt4o_meta_learning');
SELECT safe_delete_all('llm_cost_optimization');

-- ============================================================
-- SECTION 9: TRADE ANALYSIS & HISTORY
-- ============================================================

SELECT safe_delete_all('ai_trade_analysis');
SELECT safe_delete_all('trade_history');
SELECT safe_delete_all('trade_adjustments_log');

-- ============================================================
-- SECTION 10: ADDITIONAL LEARNING TABLES
-- ============================================================

SELECT safe_delete_all('weekly_meta_analyses');
SELECT safe_delete_all('daily_meta_analysis');
SELECT safe_delete_all('llm_pair_selection_tracking');
SELECT safe_delete_all('exploration_trades_log');
SELECT safe_delete_all('correlated_loss_events');
SELECT safe_delete_all('pattern_similarity_scores');
SELECT safe_delete_all('strategy_arsenal');
SELECT safe_delete_all('mid_trade_llm_evaluations');

-- ============================================================
-- CLEAN UP
-- ============================================================

DROP FUNCTION IF EXISTS safe_delete_all(text);

-- ============================================================
-- FINAL VERIFICATION
-- ============================================================

DO $$
DECLARE
  reset_timestamp timestamptz := now();
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '========================================================';
  RAISE NOTICE 'AI LEARNING COMPLETE RESET - FRESH START';
  RAISE NOTICE '========================================================';
  RAISE NOTICE 'Timestamp: %', reset_timestamp;
  RAISE NOTICE 'Reason: Position Sizing Bug Fixed - Starting Clean';
  RAISE NOTICE '';
  RAISE NOTICE 'All corrupted learning data has been cleared.';
  RAISE NOTICE 'All AI metrics have been reset to baseline.';
  RAISE NOTICE 'System is ready for accurate backtests with fixed position sizing.';
  RAISE NOTICE '';
  RAISE NOTICE '========================================================';
  RAISE NOTICE 'READY FOR CLEAN BACKTESTS';
  RAISE NOTICE '========================================================';
  RAISE NOTICE '';
END $$;
