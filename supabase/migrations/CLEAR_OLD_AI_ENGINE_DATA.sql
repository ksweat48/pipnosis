/*
  ═══════════════════════════════════════════════════════════════════════════
  CLEAR OLD AI ENGINE DATA - PREPARE FOR NEW GPT-4 SYSTEM
  ═══════════════════════════════════════════════════════════════════════════

  ⚠️ WARNING: THIS SCRIPT WILL DELETE ALL AI ENGINE DATA! ⚠️

  This script will PERMANENTLY DELETE all data from AI/backtest related tables:
  - All backtest sessions and results
  - All AI learning data, insights, and patterns
  - All skill progression and tracking data
  - All prediction and recommendation data
  - All GPT-4o meta-learning insights
  - All pattern discoveries and analysis

  PRESERVED DATA:
  - User accounts and profiles
  - Market data (forex_candles, historical_candles)
  - Chart preferences and settings
  - Trade history (trade_history table)
  - System configuration

  After running this script, you will have a clean slate ready for the new
  GPT-4 based AI engine to start fresh backtests and learning.

  ═══════════════════════════════════════════════════════════════════════════
*/

-- Disable triggers temporarily for faster deletion
SET session_replication_role = 'replica';

DO $$
BEGIN
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '⚠️  CLEARING OLD AI ENGINE DATA';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'Starting data deletion process...';
  RAISE NOTICE '';
END $$;

-- ============================================================================
-- 1. BACKTEST DATA TABLES
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '1. Clearing Backtest Data...';
END $$;

-- Delete all backtest execution data
DELETE FROM backtest_execution_logs;
DELETE FROM backtest_trades;
DELETE FROM backtest_sessions;
DELETE FROM backtest_progress_tracking;

-- Delete all synthetic backtest data
DELETE FROM synthetic_backtest_trades;
DELETE FROM synthetic_backtest_sessions;
DELETE FROM synthetic_candles;
DELETE FROM synthetic_data_generations;

-- Delete auto-backtest system data
DELETE FROM auto_backtest_health_log;
DELETE FROM auto_backtest_queue;
DELETE FROM auto_backtest_global_state;

-- Note: Keeping auto_backtest_config and auto_backtest_controller for user settings

DO $$
DECLARE
  v_backtest_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_backtest_count FROM backtest_sessions;
  RAISE NOTICE '   ✓ Cleared backtest data (remaining rows: %)', v_backtest_count;
END $$;

-- ============================================================================
-- 2. AI LEARNING AND INSIGHTS TABLES
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '2. Clearing AI Learning Data...';
END $$;

-- Delete core AI learning data
DELETE FROM ai_learning_insights;
DELETE FROM ai_learning_metrics;
DELETE FROM ai_learning_milestones;
DELETE FROM ai_session_learnings;

-- Delete AI performance tracking
DELETE FROM ai_performance_evolution;
DELETE FROM ai_capability_scores;
DELETE FROM ai_composite_scores;
DELETE FROM ai_session_pf_tracking;
DELETE FROM ai_session_wr_tracking;

-- Delete learning effectiveness tracking
DELETE FROM ai_insight_effectiveness_tracking;
DELETE FROM trade_learning_log;
DELETE FROM learning_patterns;

DO $$
DECLARE
  v_learning_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_learning_count FROM ai_learning_insights;
  RAISE NOTICE '   ✓ Cleared AI learning data (remaining rows: %)', v_learning_count;
END $$;

-- ============================================================================
-- 3. AI SKILL AND PROGRESSION TABLES
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '3. Clearing AI Skill Progression...';
END $$;

DELETE FROM ai_skill_progression;
DELETE FROM ai_skill_level_requirements;

DO $$
DECLARE
  v_skill_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_skill_count FROM ai_skill_progression;
  RAISE NOTICE '   ✓ Cleared skill progression data (remaining rows: %)', v_skill_count;
END $$;

-- ============================================================================
-- 4. PATTERN DISCOVERY AND ANALYSIS TABLES
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '4. Clearing Pattern Discovery Data...';
END $$;

DELETE FROM ai_pattern_interpretations;
DELETE FROM ai_pattern_ev_tracking;
DELETE FROM ai_pattern_graduations;
DELETE FROM ai_exploratory_patterns;
DELETE FROM pattern_context_performance;
DELETE FROM pattern_clusters;

DO $$
DECLARE
  v_pattern_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_pattern_count FROM ai_pattern_interpretations;
  RAISE NOTICE '   ✓ Cleared pattern data (remaining rows: %)', v_pattern_count;
END $$;

-- ============================================================================
-- 5. PREDICTION AND RECOMMENDATION TABLES
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '5. Clearing Predictions and Recommendations...';
END $$;

DELETE FROM ai_prediction_accuracy;
DELETE FROM ai_pair_predictions;
DELETE FROM ai_pair_analysis_snapshots;
DELETE FROM ai_recommendation_tracker;
DELETE FROM recommendation_implementation_log;
DELETE FROM llm_recommendation_logs;

DO $$
DECLARE
  v_prediction_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_prediction_count FROM ai_pair_predictions;
  RAISE NOTICE '   ✓ Cleared prediction data (remaining rows: %)', v_prediction_count;
END $$;

-- ============================================================================
-- 6. GPT-4O META-LEARNING TABLES
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '6. Clearing GPT-4o Meta-Learning Data...';
END $$;

DELETE FROM ai_meta_learning_insights;
DELETE FROM ai_meta_learning_config;
DELETE FROM batch_meta_learning_insights;
DELETE FROM gpt4o_usage_tracking;

DO $$
DECLARE
  v_gpt4o_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_gpt4o_count FROM ai_meta_learning_insights;
  RAISE NOTICE '   ✓ Cleared GPT-4o data (remaining rows: %)', v_gpt4o_count;
END $$;

-- ============================================================================
-- 7. INDICATOR AND STRATEGY TABLES
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '7. Clearing Indicator and Strategy Data...';
END $$;

DELETE FROM ai_indicator_experiments;
DELETE FROM ai_indicator_effectiveness;
DELETE FROM ai_indicator_usage_history;
DELETE FROM ai_discovered_strategies;
DELETE FROM ai_strategy_performance;
DELETE FROM ai_feature_attribution;

DO $$
DECLARE
  v_strategy_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_strategy_count FROM ai_discovered_strategies;
  RAISE NOTICE '   ✓ Cleared strategy data (remaining rows: %)', v_strategy_count;
END $$;

-- ============================================================================
-- 8. AI DECISION AND TRADE ANALYSIS TABLES
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '8. Clearing AI Decision Data...';
END $$;

DELETE FROM ai_trade_analysis;
DELETE FROM ai_trade_decisions;
DELETE FROM ai_thought_process;
DELETE FROM ai_decision_feedback;
DELETE FROM ai_risk_state;

DO $$
DECLARE
  v_decision_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_decision_count FROM ai_trade_decisions;
  RAISE NOTICE '   ✓ Cleared AI decision data (remaining rows: %)', v_decision_count;
END $$;

-- ============================================================================
-- 9. ADVANCED AI SYSTEM TABLES
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '9. Clearing Advanced AI System Data...';
END $$;

DELETE FROM ai_training_scenarios;
DELETE FROM ai_training_parameters;
DELETE FROM ai_market_scenario_performance;
DELETE FROM position_sizing_recommendations;
DELETE FROM llm_backtest_configs;
DELETE FROM goal_ai_conversations;
DELETE FROM ai_applied_adjustments;

DO $$
DECLARE
  v_training_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_training_count FROM ai_training_scenarios;
  RAISE NOTICE '   ✓ Cleared advanced AI data (remaining rows: %)', v_training_count;
END $$;

-- Re-enable triggers
SET session_replication_role = 'origin';

-- ============================================================================
-- FINAL VERIFICATION
-- ============================================================================
DO $$
DECLARE
  v_total_ai_rows INTEGER := 0;
  v_table_name TEXT;
  v_row_count INTEGER;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ DATA CLEANUP COMPLETED';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Verification - Remaining rows in AI tables:';
  RAISE NOTICE '';

  -- Check key tables for remaining data
  FOR v_table_name IN
    SELECT unnest(ARRAY[
      'backtest_sessions',
      'ai_learning_insights',
      'ai_skill_progression',
      'ai_pattern_interpretations',
      'ai_pair_predictions',
      'ai_meta_learning_insights',
      'gpt4o_usage_tracking'
    ])
  LOOP
    EXECUTE format('SELECT COUNT(*) FROM %I', v_table_name) INTO v_row_count;
    v_total_ai_rows := v_total_ai_rows + v_row_count;
    RAISE NOTICE '  %: % rows', v_table_name, v_row_count;
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE 'Total remaining AI data rows: %', v_total_ai_rows;
  RAISE NOTICE '';

  IF v_total_ai_rows = 0 THEN
    RAISE NOTICE '✅ SUCCESS: All old AI engine data has been cleared!';
  ELSE
    RAISE WARNING '⚠️  WARNING: Some AI data still remains. Please review.';
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE 'PRESERVED DATA:';
  RAISE NOTICE '  - User accounts and profiles';
  RAISE NOTICE '  - Market data and candles';
  RAISE NOTICE '  - Chart preferences';
  RAISE NOTICE '  - Trade history';
  RAISE NOTICE '';
  RAISE NOTICE 'Your database is now ready for the new GPT-4 AI engine!';
  RAISE NOTICE 'You can now start fresh backtests with the new system.';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
