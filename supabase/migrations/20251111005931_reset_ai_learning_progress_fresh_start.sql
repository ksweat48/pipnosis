/*
  # Reset AI Learning Progress to Fresh Start
  
  This migration resets all AI learning data to start fresh with the new learning rules where:
  - Only WINNING trades count toward skill advancement
  - Live demo trades have 2x learning weight
  - All previous learning history is cleared
  
  ## Changes
  
  1. **Reset ai_skill_progression**
     - Set all users back to Novice level with 0 trades
     - Clear all progress metrics
  
  2. **Clear Learning Tables**
     - Clear ai_trade_analysis (detailed trade analyses)
     - Clear ai_learning_insights (extracted patterns)
     - Clear ai_performance_evolution (daily tracking)
     - Clear ai_learning_milestones (achievements)
     - Clear ai_market_scenario_performance (scenario stats)
     - Clear trade_learning_log (learning events)
     - Clear all other AI learning and tracking tables
  
  3. **Reset Trade Analysis Flags**
     - Set ai_analyzed = false on all trades so they can be reanalyzed
     - Clear ai_analyzed_at timestamps
  
  ## Security
  - All operations respect RLS policies
  - Only affects AI learning data, not actual trade history
*/

-- Reset skill progression to Novice for all users
UPDATE ai_skill_progression
SET 
  current_skill_level = 'Novice',
  skill_level_numeric = 1,
  progress_to_next_level_percent = 0,
  total_trades_analyzed = 0,
  current_win_rate = 0,
  target_win_rate = 80,
  gap_to_target = 80,
  current_profit_factor = 0,
  trades_needed_for_next_level = 100,
  estimated_trades_to_master = 5000,
  estimated_trades_to_exceptional = 10000,
  learning_velocity_score = 0,
  total_patterns_learned = 0,
  winning_patterns_count = 0,
  losing_patterns_count = 0,
  previous_skill_level = NULL,
  last_level_up_date = NULL,
  last_level_up_trade_count = NULL,
  updated_at = now();

-- Clear all AI trade analysis records
TRUNCATE TABLE ai_trade_analysis RESTART IDENTITY CASCADE;

-- Clear all learning insights
TRUNCATE TABLE ai_learning_insights RESTART IDENTITY CASCADE;

-- Clear performance evolution tracking
TRUNCATE TABLE ai_performance_evolution RESTART IDENTITY CASCADE;

-- Clear learning milestones (we'll add one back for the reset event)
TRUNCATE TABLE ai_learning_milestones RESTART IDENTITY CASCADE;

-- Clear market scenario performance
TRUNCATE TABLE ai_market_scenario_performance RESTART IDENTITY CASCADE;

-- Clear learning metrics and log
TRUNCATE TABLE ai_learning_metrics RESTART IDENTITY CASCADE;
TRUNCATE TABLE trade_learning_log RESTART IDENTITY CASCADE;

-- Clear indicator experiments and effectiveness tracking
TRUNCATE TABLE ai_indicator_experiments RESTART IDENTITY CASCADE;
TRUNCATE TABLE ai_indicator_effectiveness RESTART IDENTITY CASCADE;
TRUNCATE TABLE ai_indicator_usage_history RESTART IDENTITY CASCADE;

-- Clear AI decision feedback and thought process
TRUNCATE TABLE ai_decision_feedback RESTART IDENTITY CASCADE;
TRUNCATE TABLE ai_thought_process RESTART IDENTITY CASCADE;

-- Clear prediction accuracy tracking
TRUNCATE TABLE ai_prediction_accuracy RESTART IDENTITY CASCADE;

-- Clear capability scores
TRUNCATE TABLE ai_capability_scores RESTART IDENTITY CASCADE;

-- Clear pair analysis and predictions
TRUNCATE TABLE ai_pair_analysis_snapshots RESTART IDENTITY CASCADE;
TRUNCATE TABLE ai_pair_predictions RESTART IDENTITY CASCADE;

-- Clear trade decisions
TRUNCATE TABLE ai_trade_decisions RESTART IDENTITY CASCADE;

-- Clear training parameters
TRUNCATE TABLE ai_training_parameters RESTART IDENTITY CASCADE;

-- Clear demo trades
TRUNCATE TABLE ai_demo_trades RESTART IDENTITY CASCADE;

-- Reset trade analysis flags so trades can be reanalyzed with new rules
UPDATE trade_history
SET 
  ai_analyzed = false,
  ai_analyzed_at = NULL
WHERE ai_analyzed = true;

-- Log the reset event as a consistency achievement milestone
DO $$
DECLARE
  admin_user_id uuid;
BEGIN
  -- Get the first admin user
  SELECT id INTO admin_user_id FROM user_profiles WHERE is_admin = true LIMIT 1;
  
  IF admin_user_id IS NOT NULL THEN
    INSERT INTO ai_learning_milestones (
      user_id,
      milestone_type,
      milestone_title,
      milestone_description,
      skill_level_at_achievement,
      total_trades_at_achievement,
      win_rate_at_achievement
    ) VALUES (
      admin_user_id,
      'consistency_achievement',
      'AI Learning System Reset - Fresh Start',
      'Learning progress reset to Novice (0 trades). New rules: Only winning trades count toward skill advancement. Live trades have 2x learning weight.',
      'Novice',
      0,
      0
    );
  END IF;
END $$;
