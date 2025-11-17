-- ============================================================================
-- SIMPLIFIED AI DATA CLEANUP SCRIPT
-- Run this script in your Supabase SQL Editor to clear all old AI engine data
-- ============================================================================

-- BATCH 1: Learning and Insights
TRUNCATE TABLE ai_learning_insights CASCADE;
TRUNCATE TABLE ai_learning_metrics CASCADE;
TRUNCATE TABLE ai_learning_milestones CASCADE;

-- BATCH 2: GPT-4o and Meta-Learning
TRUNCATE TABLE gpt4o_usage_tracking CASCADE;
TRUNCATE TABLE ai_meta_learning_insights CASCADE;
TRUNCATE TABLE ai_meta_learning_config CASCADE;
TRUNCATE TABLE batch_meta_learning_insights CASCADE;

-- BATCH 3: Skills and Progression
TRUNCATE TABLE ai_skill_progression CASCADE;
TRUNCATE TABLE ai_skill_level_requirements CASCADE;

-- BATCH 4: Patterns and Analysis
TRUNCATE TABLE ai_pattern_interpretations CASCADE;
TRUNCATE TABLE ai_pattern_ev_tracking CASCADE;
TRUNCATE TABLE ai_pattern_graduations CASCADE;
TRUNCATE TABLE pattern_context_performance CASCADE;
TRUNCATE TABLE pattern_clusters CASCADE;

-- BATCH 5: Predictions and Recommendations
TRUNCATE TABLE ai_prediction_accuracy CASCADE;
TRUNCATE TABLE ai_pair_predictions CASCADE;
TRUNCATE TABLE ai_recommendation_tracker CASCADE;
TRUNCATE TABLE llm_recommendation_logs CASCADE;

-- BATCH 6: Performance and Tracking
TRUNCATE TABLE ai_performance_evolution CASCADE;
TRUNCATE TABLE ai_capability_scores CASCADE;
TRUNCATE TABLE ai_composite_scores CASCADE;
TRUNCATE TABLE ai_session_pf_tracking CASCADE;
TRUNCATE TABLE ai_session_wr_tracking CASCADE;

-- BATCH 7: Backtests
TRUNCATE TABLE backtest_sessions CASCADE;
TRUNCATE TABLE backtest_trades CASCADE;
TRUNCATE TABLE backtest_execution_logs CASCADE;
TRUNCATE TABLE backtest_progress_tracking CASCADE;

-- BATCH 8: Synthetic Data
TRUNCATE TABLE synthetic_backtest_sessions CASCADE;
TRUNCATE TABLE synthetic_backtest_trades CASCADE;
TRUNCATE TABLE synthetic_candles CASCADE;
TRUNCATE TABLE synthetic_data_generations CASCADE;

-- BATCH 9: Auto-Backtest
TRUNCATE TABLE auto_backtest_queue CASCADE;
TRUNCATE TABLE auto_backtest_health_log CASCADE;

-- BATCH 10: Indicators and Strategies
TRUNCATE TABLE ai_indicator_experiments CASCADE;
TRUNCATE TABLE ai_indicator_effectiveness CASCADE;
TRUNCATE TABLE ai_indicator_usage_history CASCADE;
TRUNCATE TABLE ai_discovered_strategies CASCADE;
TRUNCATE TABLE ai_strategy_performance CASCADE;

-- BATCH 11: Decisions and Trade Analysis
TRUNCATE TABLE ai_trade_analysis CASCADE;
TRUNCATE TABLE ai_trade_decisions CASCADE;
TRUNCATE TABLE ai_thought_process CASCADE;
TRUNCATE TABLE ai_decision_feedback CASCADE;

-- BATCH 12: Advanced Systems
TRUNCATE TABLE ai_training_scenarios CASCADE;
TRUNCATE TABLE ai_training_parameters CASCADE;
TRUNCATE TABLE goal_ai_conversations CASCADE;
TRUNCATE TABLE ai_applied_adjustments CASCADE;

-- BATCH 13: Additional Tables
TRUNCATE TABLE ai_session_learnings CASCADE;
TRUNCATE TABLE ai_exploratory_patterns CASCADE;
TRUNCATE TABLE ai_pair_analysis_snapshots CASCADE;
TRUNCATE TABLE recommendation_implementation_log CASCADE;
TRUNCATE TABLE ai_insight_effectiveness_tracking CASCADE;
TRUNCATE TABLE trade_learning_log CASCADE;
TRUNCATE TABLE learning_patterns CASCADE;
TRUNCATE TABLE ai_risk_state CASCADE;
TRUNCATE TABLE ai_feature_attribution CASCADE;
TRUNCATE TABLE ai_market_scenario_performance CASCADE;
TRUNCATE TABLE position_sizing_recommendations CASCADE;
TRUNCATE TABLE llm_backtest_configs CASCADE;

-- Optional: Clear auto-backtest state (if you want to reset it)
-- TRUNCATE TABLE auto_backtest_global_state CASCADE;

-- Verification Query
SELECT
  'backtest_sessions' as table_name, COUNT(*) as remaining_rows FROM backtest_sessions
UNION ALL
SELECT 'ai_learning_insights', COUNT(*) FROM ai_learning_insights
UNION ALL
SELECT 'ai_skill_progression', COUNT(*) FROM ai_skill_progression
UNION ALL
SELECT 'gpt4o_usage_tracking', COUNT(*) FROM gpt4o_usage_tracking
UNION ALL
SELECT 'ai_pattern_interpretations', COUNT(*) FROM ai_pattern_interpretations
UNION ALL
SELECT 'synthetic_backtest_sessions', COUNT(*) FROM synthetic_backtest_sessions
ORDER BY remaining_rows DESC;
