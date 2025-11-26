/*
  # Clear Old UI Data for Fresh Start

  1. Purpose
    - Remove all old backtest sessions to start fresh
    - Clear AI learning data for clean slate
    - Reset skill progression to Novice with new thresholds
    - Keep database schema intact (only clear data)

  2. New Skill Level Thresholds
    - Novice: 100+ wins, 35% WR, 1.0+ PF
    - Intermediate: 250+ wins, 45% WR, 1.2+ PF
    - Pro: 500+ wins, 55% WR, 1.5+ PF
    - Expert: 1000+ wins, 65% WR, 1.8+ PF
    - Master: 2500+ wins, 75% WR, 2.0+ PF
    - Exceptional: 5000+ wins, 85% WR, 2.5+ PF
*/

-- Clear synthetic backtest data
TRUNCATE TABLE synthetic_backtest_trades CASCADE;
TRUNCATE TABLE synthetic_backtest_sessions CASCADE;

-- Clear real backtest data
DELETE FROM trade_history WHERE is_synthetic = true;
TRUNCATE TABLE backtest_sessions CASCADE;
TRUNCATE TABLE backtest_trades CASCADE;

-- Clear daily session results
TRUNCATE TABLE daily_session_results CASCADE;

-- Clear AI session learnings
TRUNCATE TABLE ai_session_learnings CASCADE;

-- Clear AI learning insights and records
TRUNCATE TABLE ai_learning_insights CASCADE;
TRUNCATE TABLE ai_learning_metrics CASCADE;
TRUNCATE TABLE ai_learning_milestones CASCADE;
TRUNCATE TABLE ai_trade_learning_records CASCADE;
TRUNCATE TABLE trade_learning_log CASCADE;
TRUNCATE TABLE daily_learning_insights CASCADE;
TRUNCATE TABLE daily_learning_aggregations CASCADE;

-- Clear AI analysis data
TRUNCATE TABLE ai_trade_analysis CASCADE;
TRUNCATE TABLE ai_confidence_history CASCADE;
TRUNCATE TABLE ai_pattern_ev_tracking CASCADE;

-- Clear AI performance evolution
TRUNCATE TABLE ai_performance_evolution CASCADE;

-- Clear meta learning
TRUNCATE TABLE ai_meta_learning_insights CASCADE;
TRUNCATE TABLE ai_thought_process CASCADE;
TRUNCATE TABLE ai_thought_stream CASCADE;

-- Clear learning patterns
TRUNCATE TABLE learning_patterns CASCADE;

-- Clear KPI and tracking tables
TRUNCATE TABLE continuous_learning_kpis CASCADE;
TRUNCATE TABLE ai_confidence_calibration CASCADE;
TRUNCATE TABLE ai_confidence_performance CASCADE;
TRUNCATE TABLE ai_recommendation_tracker CASCADE;
TRUNCATE TABLE pattern_clusters CASCADE;

-- Clear daily meta analysis
TRUNCATE TABLE daily_meta_analysis CASCADE;
TRUNCATE TABLE weekly_meta_analyses CASCADE;

-- Clear LLM tracking
TRUNCATE TABLE llm_layer_decision_log CASCADE;
TRUNCATE TABLE llm_session_analysis CASCADE;
TRUNCATE TABLE llm_exit_decisions_log CASCADE;
TRUNCATE TABLE mid_trade_llm_evaluations CASCADE;

-- Reset auto-backtest state
UPDATE auto_backtest_global_state
SET
  is_running = false,
  is_paused = false,
  total_months_completed = 0,
  current_month_number = 0,
  current_day_in_month = 0,
  last_day_number = NULL,
  last_day_session_name = NULL,
  last_day_win_rate = NULL,
  last_day_total_trades = NULL,
  last_day_pnl = NULL,
  last_day_completed_at = NULL,
  plateau_detected = false,
  breakthrough_mode = false,
  plateau_duration = 0,
  monthly_parent_session_id = NULL,
  last_error_message = NULL,
  last_error_at = NULL,
  paused_at = NULL,
  resumed_at = NULL,
  last_status_message = 'Ready to start fresh',
  last_status_updated_at = NOW(),
  updated_at = NOW();

-- Reset skill progression to Novice level with NEW thresholds
UPDATE ai_skill_progression
SET
  current_skill_level = 'Novice',
  skill_level_numeric = 1,
  progress_to_next_level_percent = 0.0,
  total_trades_analyzed = 0,
  current_win_rate = 0.0,
  target_win_rate = 35.0,
  gap_to_target = 35.0,
  current_profit_factor = 0.0,
  trades_needed_for_next_level = 100,
  estimated_trades_to_master = 2500,
  estimated_trades_to_exceptional = 5000,
  learning_velocity_score = 0.0,
  total_patterns_learned = 0,
  winning_patterns_count = 0,
  losing_patterns_count = 0,
  total_backtests_completed = 0,
  total_synthetic_backtests = 0,
  total_real_backtests = 0,
  total_trades_for_pf_calc = 0,
  total_losing_trades = 0,
  last_10_session_wr_avg = 0.0,
  last_10_session_pf_avg = 0.0,
  last_10_session_consistency_pct = 0.0,
  updated_at = NOW();

-- Success message
DO $$
BEGIN
  RAISE NOTICE '══════════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ Database cleared successfully!';
  RAISE NOTICE '══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'All old backtest sessions, trades, and AI learning data removed.';
  RAISE NOTICE '';
  RAISE NOTICE 'Skill progression reset to Novice level with NEW thresholds:';
  RAISE NOTICE '  🏆 Novice:        100+ wins, 35%% WR, 1.0+ PF';
  RAISE NOTICE '  🏆 Intermediate:  250+ wins, 45%% WR, 1.2+ PF';
  RAISE NOTICE '  🏆 Pro:           500+ wins, 55%% WR, 1.5+ PF';
  RAISE NOTICE '  🏆 Expert:       1000+ wins, 65%% WR, 1.8+ PF';
  RAISE NOTICE '  🏆 Master:       2500+ wins, 75%% WR, 2.0+ PF';
  RAISE NOTICE '  🏆 Exceptional:  5000+ wins, 85%% WR, 2.5+ PF';
  RAISE NOTICE '';
  RAISE NOTICE '🚀 Ready to start fresh auto-backtest sessions!';
  RAISE NOTICE '══════════════════════════════════════════════════════════════';
END $$;
