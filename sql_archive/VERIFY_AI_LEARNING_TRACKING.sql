-- ============================================================================
-- AI LEARNING TRACKING VERIFICATION QUERIES
-- Use these queries in Supabase SQL Editor to verify learning is working
-- ============================================================================

-- Query 1: Check Overall AI Skill Progression
-- This shows the main tracking metrics including the newly fixed fields
SELECT
  current_skill_level,
  total_trades_analyzed,
  current_win_rate,
  current_profit_factor,
  current_confidence_accuracy, -- NEW: Should show accuracy percentage
  total_backtests_completed,   -- NEW: Should increment after each backtest
  total_synthetic_backtests,   -- NEW: Count of synthetic backtests
  total_real_backtests,        -- NEW: Count of real backtests
  progress_to_next_level_percent,
  learning_velocity_score,
  last_trade_analyzed_date,
  updated_at
FROM ai_skill_progression
WHERE user_id = 'YOUR_USER_ID_HERE'; -- Replace with your actual user ID


-- Query 2: Check Recent Learning Activity
-- Shows if new insights are being generated
SELECT
  created_at,
  insight_type,
  insight_title,
  confidence_score,
  symbol,
  is_from_live_trading,
  learning_weight
FROM ai_learning_insights
WHERE user_id = 'YOUR_USER_ID_HERE'
ORDER BY created_at DESC
LIMIT 20;


-- Query 3: Check Trade Analysis
-- Verifies individual trades are being analyzed
SELECT
  created_at,
  symbol,
  direction,
  outcome,
  pnl,
  entry_confidence,
  ai_conviction_level,
  realized_rr,
  expected_value,
  trade_quality_score
FROM ai_trade_analysis
WHERE user_id = 'YOUR_USER_ID_HERE'
ORDER BY created_at DESC
LIMIT 20;


-- Query 4: Check Performance Evolution Over Time
-- Shows if AI performance is being tracked historically
SELECT
  measurement_date,
  symbol,
  strategy_name,
  total_trades,
  win_rate,
  profit_factor,
  ai_decisions_made,
  ai_decision_accuracy,
  is_improving
FROM ai_performance_evolution
WHERE user_id = 'YOUR_USER_ID_HERE'
ORDER BY measurement_date DESC
LIMIT 20;


-- Query 5: Check Session Learning Summaries
-- Shows what the AI learned from each backtest session
SELECT
  created_at,
  session_type,
  total_trades,
  winning_trades,
  losing_trades,
  win_rate,
  profit_factor,
  key_insights,
  patterns_discovered,
  improvement_areas
FROM ai_session_learnings
WHERE user_id = 'YOUR_USER_ID_HERE'
ORDER BY created_at DESC
LIMIT 10;


-- Query 6: Confidence Accuracy Breakdown
-- Shows how accurate AI predictions are at different confidence levels
WITH confidence_buckets AS (
  SELECT
    CASE
      WHEN entry_confidence >= 95 THEN '95-100%'
      WHEN entry_confidence >= 90 THEN '90-95%'
      WHEN entry_confidence >= 85 THEN '85-90%'
      WHEN entry_confidence >= 80 THEN '80-85%'
      WHEN entry_confidence >= 75 THEN '75-80%'
      WHEN entry_confidence >= 70 THEN '70-75%'
      ELSE '<70%'
    END as confidence_bucket,
    outcome,
    entry_confidence
  FROM ai_trade_analysis
  WHERE user_id = 'YOUR_USER_ID_HERE'
    AND entry_confidence IS NOT NULL
)
SELECT
  confidence_bucket,
  COUNT(*) as total_trades,
  COUNT(CASE WHEN outcome = 'win' THEN 1 END) as wins,
  ROUND(AVG(CASE WHEN outcome = 'win' THEN 100.0 ELSE 0 END), 2) as actual_win_rate,
  ROUND(AVG(entry_confidence), 2) as avg_predicted_confidence,
  ROUND(AVG(entry_confidence) - AVG(CASE WHEN outcome = 'win' THEN 100.0 ELSE 0 END), 2) as calibration_error
FROM confidence_buckets
GROUP BY confidence_bucket
ORDER BY confidence_bucket DESC;


-- Query 7: Learning Progress Summary (All-in-One)
-- Complete overview of AI learning status
SELECT
  'Total Trades Analyzed' as metric,
  total_trades_analyzed::text as value
FROM ai_skill_progression WHERE user_id = 'YOUR_USER_ID_HERE'

UNION ALL

SELECT
  'Total Backtests Completed' as metric,
  total_backtests_completed::text as value
FROM ai_skill_progression WHERE user_id = 'YOUR_USER_ID_HERE'

UNION ALL

SELECT
  'Confidence Accuracy' as metric,
  ROUND(current_confidence_accuracy, 2)::text || '%' as value
FROM ai_skill_progression WHERE user_id = 'YOUR_USER_ID_HERE'

UNION ALL

SELECT
  'Current Win Rate' as metric,
  ROUND(current_win_rate, 2)::text || '%' as value
FROM ai_skill_progression WHERE user_id = 'YOUR_USER_ID_HERE'

UNION ALL

SELECT
  'Total Learning Insights' as metric,
  COUNT(*)::text as value
FROM ai_learning_insights WHERE user_id = 'YOUR_USER_ID_HERE'

UNION ALL

SELECT
  'Patterns Learned' as metric,
  total_patterns_learned::text as value
FROM ai_skill_progression WHERE user_id = 'YOUR_USER_ID_HERE'

UNION ALL

SELECT
  'Skill Level' as metric,
  current_skill_level::text as value
FROM ai_skill_progression WHERE user_id = 'YOUR_USER_ID_HERE';


-- ============================================================================
-- TROUBLESHOOTING QUERIES
-- ============================================================================

-- Check if learning engine is running after backtests
SELECT
  'Last backtest session at' as info,
  MAX(created_at)::text as timestamp
FROM ai_session_learnings
WHERE user_id = 'YOUR_USER_ID_HERE'

UNION ALL

SELECT
  'Last trade analyzed at' as info,
  MAX(created_at)::text as timestamp
FROM ai_trade_analysis
WHERE user_id = 'YOUR_USER_ID_HERE'

UNION ALL

SELECT
  'Last skill update at' as info,
  updated_at::text as timestamp
FROM ai_skill_progression
WHERE user_id = 'YOUR_USER_ID_HERE';


-- Check for any stuck or failed learning processes
SELECT
  COUNT(*) as pending_analysis_count,
  'Trades awaiting AI analysis' as description
FROM trade_history
WHERE user_id = 'YOUR_USER_ID_HERE'
  AND ai_analyzed = false
  AND closed_at IS NOT NULL;
