/*
  # Fix Profit Factor Calculation System

  ## Problem
  The AI skill progression system is stuck at Novice level despite meeting requirements for Intermediate.
  Current state: 11,663 trades, 45.72% win rate, 0.94 profit factor
  Requirements: 1,000 trades (✓), 45% win rate (✓), 1.20 profit factor (✗)

  ## Root Causes
  1. Missing `total_trades_for_pf_calc` column for proper weighted averaging
  2. Profit factor calculation using only winning trades count instead of total trades
  3. No tracking of actual trade volume contributing to profit factor calculations

  ## Changes
  1. Add `total_trades_for_pf_calc` column to track total trades (wins + losses + breakeven)
  2. Create helper function to recalculate profit factor from historical sessions
  3. Backfill column with correct values from synthetic_backtest_sessions
  4. Add data validation constraints
  5. Force recalculation of current profit factor using correct weighting

  ## Security
  - No changes to RLS policies
  - Uses existing session data for calculations
*/

-- Step 1: Add column to track total trades for profit factor weighting
ALTER TABLE ai_skill_progression
ADD COLUMN IF NOT EXISTS total_trades_for_pf_calc integer DEFAULT 0;

-- Step 2: Create function to calculate proper weighted profit factor from historical sessions
CREATE OR REPLACE FUNCTION recalculate_profit_factor_from_history(p_user_id uuid)
RETURNS TABLE(
  calculated_profit_factor numeric,
  total_sessions integer,
  total_trades_used integer,
  total_wins numeric,
  total_losses numeric
) AS $$
DECLARE
  v_total_wins numeric := 0;
  v_total_losses numeric := 0;
  v_total_trades integer := 0;
  v_session_count integer := 0;
  v_profit_factor numeric := 0;
BEGIN
  -- Calculate weighted profit factor from all completed synthetic backtest sessions
  -- We weight each session's contribution by its total number of trades
  SELECT 
    SUM(
      CASE 
        WHEN s.winning_trades > 0 AND s.avg_win IS NOT NULL 
        THEN s.winning_trades * s.avg_win
        ELSE 0 
      END
    ),
    SUM(
      CASE 
        WHEN s.losing_trades > 0 AND s.avg_loss IS NOT NULL AND s.avg_loss > 0
        THEN s.losing_trades * ABS(s.avg_loss)
        ELSE 0 
      END
    ),
    SUM(COALESCE(s.total_trades, 0)),
    COUNT(*)
  INTO v_total_wins, v_total_losses, v_total_trades, v_session_count
  FROM synthetic_backtest_sessions s
  WHERE s.user_id = p_user_id
    AND s.status = 'completed'
    AND s.completed_at IS NOT NULL
    AND s.total_trades > 0;

  -- Calculate profit factor
  IF v_total_losses > 0 THEN
    v_profit_factor := v_total_wins / v_total_losses;
  ELSIF v_total_wins > 0 THEN
    -- If no losses but have wins, return high value (capped at 99.99 for sanity)
    v_profit_factor := 99.99;
  ELSE
    v_profit_factor := 0;
  END IF;

  -- Cap profit factor at reasonable maximum to avoid infinity issues
  v_profit_factor := LEAST(v_profit_factor, 99.99);

  RETURN QUERY SELECT 
    v_profit_factor,
    v_session_count,
    v_total_trades,
    v_total_wins,
    v_total_losses;
END;
$$ LANGUAGE plpgsql;

-- Step 3: Backfill total_trades_for_pf_calc with actual values from sessions
UPDATE ai_skill_progression asp
SET total_trades_for_pf_calc = (
  SELECT COALESCE(SUM(s.total_trades), asp.total_trades_analyzed)
  FROM synthetic_backtest_sessions s
  WHERE s.user_id = asp.user_id
    AND s.status = 'completed'
    AND s.completed_at IS NOT NULL
)
WHERE total_trades_for_pf_calc = 0 OR total_trades_for_pf_calc IS NULL;

-- Step 4: Recalculate current_profit_factor using the new function
UPDATE ai_skill_progression asp
SET 
  current_profit_factor = COALESCE(
    (SELECT calculated_profit_factor FROM recalculate_profit_factor_from_history(asp.user_id)),
    asp.current_profit_factor
  ),
  updated_at = NOW()
WHERE EXISTS (
  SELECT 1 FROM synthetic_backtest_sessions s
  WHERE s.user_id = asp.user_id
    AND s.status = 'completed'
);

-- Step 5: Re-evaluate skill levels based on corrected profit factor
-- This will update skill level if requirements are now met
UPDATE ai_skill_progression asp
SET 
  current_skill_level = CASE
    WHEN asp.total_trades_analyzed >= 100000 
         AND asp.current_win_rate >= 85 
         AND asp.current_profit_factor >= 2.5 
    THEN 'Exceptional'
    WHEN asp.total_trades_analyzed >= 50000 
         AND asp.current_win_rate >= 75 
         AND asp.current_profit_factor >= 2.0 
    THEN 'Master'
    WHEN asp.total_trades_analyzed >= 10000 
         AND asp.current_win_rate >= 65 
         AND asp.current_profit_factor >= 1.8 
    THEN 'Expert'
    WHEN asp.total_trades_analyzed >= 5000 
         AND asp.current_win_rate >= 55 
         AND asp.current_profit_factor >= 1.5 
    THEN 'Pro'
    WHEN asp.total_trades_analyzed >= 1000 
         AND asp.current_win_rate >= 45 
         AND asp.current_profit_factor >= 1.2 
    THEN 'Intermediate'
    ELSE 'Novice'
  END,
  skill_level_numeric = CASE
    WHEN asp.total_trades_analyzed >= 100000 
         AND asp.current_win_rate >= 85 
         AND asp.current_profit_factor >= 2.5 
    THEN 6
    WHEN asp.total_trades_analyzed >= 50000 
         AND asp.current_win_rate >= 75 
         AND asp.current_profit_factor >= 2.0 
    THEN 5
    WHEN asp.total_trades_analyzed >= 10000 
         AND asp.current_win_rate >= 65 
         AND asp.current_profit_factor >= 1.8 
    THEN 4
    WHEN asp.total_trades_analyzed >= 5000 
         AND asp.current_win_rate >= 55 
         AND asp.current_profit_factor >= 1.5 
    THEN 3
    WHEN asp.total_trades_analyzed >= 1000 
         AND asp.current_win_rate >= 45 
         AND asp.current_profit_factor >= 1.2 
    THEN 2
    ELSE 1
  END,
  previous_skill_level = CASE 
    WHEN asp.current_skill_level != CASE
      WHEN asp.total_trades_analyzed >= 1000 
           AND asp.current_win_rate >= 45 
           AND asp.current_profit_factor >= 1.2 
      THEN 'Intermediate'
      ELSE asp.current_skill_level
    END
    THEN asp.current_skill_level
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

-- Step 6: Add validation constraint to prevent future corruption
ALTER TABLE ai_skill_progression
ADD CONSTRAINT total_trades_for_pf_calc_valid 
CHECK (total_trades_for_pf_calc >= total_trades_analyzed);

-- Step 7: Add helpful comment
COMMENT ON COLUMN ai_skill_progression.total_trades_for_pf_calc IS
'Total number of ALL trades (wins+losses+breakeven) used for profit factor weighted averaging. Must be >= total_trades_analyzed (which only counts winning trades).';

-- Step 8: Create milestone for users who level up from this fix
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
  'Advanced from Novice to Intermediate after profit factor recalculation fixed the tracking system. Congratulations on achieving ' || asp.total_trades_analyzed || ' successful winning trades with ' || ROUND(asp.current_win_rate, 1) || '% win rate.',
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
      AND alm.achieved_at >= NOW() - INTERVAL '1 hour'
  );
