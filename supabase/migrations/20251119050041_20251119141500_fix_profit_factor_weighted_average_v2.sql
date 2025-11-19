/*
  # Fix Profit Factor Calculation - Weighted Average Method (V2)

  ## Changes
  Drop and recreate function with correct return type for weighted average calculation
*/

-- Drop existing function
DROP FUNCTION IF EXISTS recalculate_profit_factor_from_history(uuid);

-- Recreate with weighted average method
CREATE OR REPLACE FUNCTION recalculate_profit_factor_from_history(p_user_id uuid)
RETURNS TABLE(
  calculated_profit_factor numeric,
  total_sessions integer,
  total_trades_used integer,
  weighted_sum numeric,
  trade_count_sum integer
) AS $$
DECLARE
  v_weighted_sum numeric := 0;
  v_trade_count_sum integer := 0;
  v_session_count integer := 0;
  v_profit_factor numeric := 0;
BEGIN
  -- Calculate WEIGHTED AVERAGE of session profit factors
  -- Weight each session's PF by its number of trades
  SELECT 
    SUM(
      CASE 
        WHEN s.total_trades > 0 AND s.profit_factor IS NOT NULL
        THEN LEAST(s.profit_factor, 99.99) * s.total_trades
        ELSE 0 
      END
    ),
    SUM(
      CASE 
        WHEN s.total_trades > 0 AND s.profit_factor IS NOT NULL
        THEN s.total_trades
        ELSE 0 
      END
    ),
    COUNT(*)
  INTO v_weighted_sum, v_trade_count_sum, v_session_count
  FROM synthetic_backtest_sessions s
  WHERE s.user_id = p_user_id
    AND s.status = 'completed'
    AND s.completed_at IS NOT NULL
    AND s.total_trades > 0
    AND s.profit_factor IS NOT NULL;

  -- Calculate weighted average
  IF v_trade_count_sum > 0 THEN
    v_profit_factor := v_weighted_sum / v_trade_count_sum;
  ELSE
    v_profit_factor := 0;
  END IF;

  v_profit_factor := LEAST(v_profit_factor, 99.99);

  RETURN QUERY SELECT 
    v_profit_factor,
    v_session_count,
    v_trade_count_sum,
    v_weighted_sum,
    v_trade_count_sum;
END;
$$ LANGUAGE plpgsql;

-- Recalculate profit factor
UPDATE ai_skill_progression asp
SET 
  current_profit_factor = COALESCE(
    (SELECT calculated_profit_factor FROM recalculate_profit_factor_from_history(asp.user_id)),
    asp.current_profit_factor
  ),
  updated_at = NOW();

-- Re-evaluate skill levels
UPDATE ai_skill_progression asp
SET 
  current_skill_level = CASE
    WHEN asp.total_trades_analyzed >= 1000 
         AND asp.current_win_rate >= 45 
         AND asp.current_profit_factor >= 1.2 
    THEN 'Intermediate'
    ELSE asp.current_skill_level
  END,
  skill_level_numeric = CASE
    WHEN asp.total_trades_analyzed >= 1000 
         AND asp.current_win_rate >= 45 
         AND asp.current_profit_factor >= 1.2 
    THEN 2
    ELSE asp.skill_level_numeric
  END,
  previous_skill_level = CASE 
    WHEN asp.current_skill_level = 'Novice'
         AND asp.total_trades_analyzed >= 1000 
         AND asp.current_win_rate >= 45 
         AND asp.current_profit_factor >= 1.2
    THEN 'Novice'
    ELSE asp.previous_skill_level
  END,
  last_level_up_date = CASE
    WHEN asp.current_skill_level = 'Novice'
         AND asp.total_trades_analyzed >= 1000 
         AND asp.current_win_rate >= 45 
         AND asp.current_profit_factor >= 1.2
    THEN NOW()
    ELSE asp.last_level_up_date
  END,
  last_level_up_trade_count = CASE
    WHEN asp.current_skill_level = 'Novice'
         AND asp.total_trades_analyzed >= 1000 
         AND asp.current_win_rate >= 45 
         AND asp.current_profit_factor >= 1.2
    THEN asp.total_trades_analyzed
    ELSE asp.last_level_up_trade_count
  END,
  updated_at = NOW()
WHERE asp.current_skill_level = 'Novice'
  AND asp.total_trades_analyzed >= 1000 
  AND asp.current_win_rate >= 45 
  AND asp.current_profit_factor >= 1.2;

-- Create milestone
INSERT INTO ai_learning_milestones (
  user_id,
  milestone_type,
  milestone_title,
  milestone_description,
  skill_level_at_achievement,
  total_trades_at_achievement,
  win_rate_at_achievement
)
SELECT 
  asp.user_id,
  'skill_level_up',
  'Reached Intermediate Level!',
  'Advanced from Novice to Intermediate with ' || asp.total_trades_analyzed || ' winning trades, ' || ROUND(asp.current_win_rate, 1) || '% win rate, and ' || ROUND(asp.current_profit_factor, 2) || ' profit factor.',
  'Intermediate',
  asp.total_trades_analyzed,
  asp.current_win_rate
FROM ai_skill_progression asp
WHERE asp.current_skill_level = 'Intermediate'
  AND asp.previous_skill_level = 'Novice'
  AND asp.last_level_up_date >= NOW() - INTERVAL '1 minute'
  AND NOT EXISTS (
    SELECT 1 FROM ai_learning_milestones alm
    WHERE alm.user_id = asp.user_id
      AND alm.milestone_type = 'skill_level_up'
      AND alm.skill_level_at_achievement = 'Intermediate'
      AND alm.achieved_at >= NOW() - INTERVAL '10 minutes'
  );
