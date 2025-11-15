/*
  # Fix Skill Progression and Backfill from Existing Trade Data

  1. Problem
    - Backtests are completing successfully with winning trades
    - But ai_skill_progression.total_trades_analyzed remains at 0
    - 107 winning trades exist in ai_trade_analysis but aren't reflected

  2. Solution
    - Recalculate skill progression from existing trade analysis data
    - Update total_trades_analyzed to match actual winning trades
    - Recalculate win rate and profit factor
    - Determine correct skill level based on thresholds

  3. Skill Level Thresholds
    - Novice: 0-499 winning trades, 0%+ win rate
    - Intermediate: 500+ winning trades, 45%+ win rate, 1.2+ PF
    - Pro: 1000+ winning trades, 55%+ win rate, 1.5+ PF
    - Expert: 5000+ winning trades, 65%+ win rate, 1.8+ PF
    - Master: 10000+ winning trades, 75%+ win rate, 2.0+ PF
    - Exceptional: 50000+ winning trades, 85%+ win rate, 2.5+ PF
*/

-- Step 1: Calculate current stats from existing trade analysis
WITH trade_stats AS (
  SELECT
    user_id,
    COUNT(*) FILTER (WHERE outcome = 'win') as winning_trades,
    COUNT(*) FILTER (WHERE outcome = 'loss') as losing_trades,
    COUNT(*) as total_analyzed,
    ROUND(100.0 * COUNT(*) FILTER (WHERE outcome = 'win') / NULLIF(COUNT(*), 0), 2) as win_rate,
    SUM(CASE WHEN outcome = 'win' THEN pnl ELSE 0 END) as total_wins,
    ABS(SUM(CASE WHEN outcome = 'loss' THEN pnl ELSE 0 END)) as total_losses,
    CASE
      WHEN ABS(SUM(CASE WHEN outcome = 'loss' THEN pnl ELSE 0 END)) > 0
      THEN ROUND(SUM(CASE WHEN outcome = 'win' THEN pnl ELSE 0 END) /
                 ABS(SUM(CASE WHEN outcome = 'loss' THEN pnl ELSE 0 END)), 2)
      ELSE 0
    END as profit_factor
  FROM ai_trade_analysis
  WHERE created_at >= CURRENT_DATE - INTERVAL '90 days' -- Last 90 days
  GROUP BY user_id
),
skill_level_calc AS (
  SELECT
    user_id,
    winning_trades,
    losing_trades,
    total_analyzed,
    win_rate,
    profit_factor,
    -- Determine skill level based on thresholds
    CASE
      WHEN winning_trades >= 50000 AND win_rate >= 85 AND profit_factor >= 2.5 THEN 'Exceptional'
      WHEN winning_trades >= 10000 AND win_rate >= 75 AND profit_factor >= 2.0 THEN 'Master'
      WHEN winning_trades >= 5000 AND win_rate >= 65 AND profit_factor >= 1.8 THEN 'Expert'
      WHEN winning_trades >= 1000 AND win_rate >= 55 AND profit_factor >= 1.5 THEN 'Pro'
      WHEN winning_trades >= 500 AND win_rate >= 45 AND profit_factor >= 1.2 THEN 'Intermediate'
      ELSE 'Novice'
    END as calculated_skill_level,
    CASE
      WHEN winning_trades >= 50000 AND win_rate >= 85 AND profit_factor >= 2.5 THEN 6
      WHEN winning_trades >= 10000 AND win_rate >= 75 AND profit_factor >= 2.0 THEN 5
      WHEN winning_trades >= 5000 AND win_rate >= 65 AND profit_factor >= 1.8 THEN 4
      WHEN winning_trades >= 1000 AND win_rate >= 55 AND profit_factor >= 1.5 THEN 3
      WHEN winning_trades >= 500 AND win_rate >= 45 AND profit_factor >= 1.2 THEN 2
      ELSE 1
    END as skill_level_numeric,
    -- Calculate progress to next level
    CASE
      WHEN winning_trades >= 50000 THEN 100.0 -- Max level
      WHEN winning_trades >= 10000 THEN LEAST(100.0, ((winning_trades - 10000)::numeric / (50000 - 10000)) * 100)
      WHEN winning_trades >= 5000 THEN LEAST(100.0, ((winning_trades - 5000)::numeric / (10000 - 5000)) * 100)
      WHEN winning_trades >= 1000 THEN LEAST(100.0, ((winning_trades - 1000)::numeric / (5000 - 1000)) * 100)
      WHEN winning_trades >= 500 THEN LEAST(100.0, ((winning_trades - 500)::numeric / (1000 - 500)) * 100)
      ELSE LEAST(100.0, (winning_trades::numeric / 500) * 100)
    END as progress_percent,
    -- Calculate trades needed for next level
    CASE
      WHEN winning_trades >= 50000 THEN 0
      WHEN winning_trades >= 10000 THEN 50000 - winning_trades
      WHEN winning_trades >= 5000 THEN 10000 - winning_trades
      WHEN winning_trades >= 1000 THEN 5000 - winning_trades
      WHEN winning_trades >= 500 THEN 1000 - winning_trades
      ELSE 500 - winning_trades
    END as trades_needed
  FROM trade_stats
)

-- Step 2: Update ai_skill_progression with corrected data
UPDATE ai_skill_progression sp
SET
  current_skill_level = slc.calculated_skill_level,
  skill_level_numeric = slc.skill_level_numeric,
  progress_to_next_level_percent = slc.progress_percent,
  total_trades_analyzed = slc.winning_trades,
  current_win_rate = slc.win_rate,
  gap_to_target = 80.0 - slc.win_rate,
  current_profit_factor = slc.profit_factor,
  trades_needed_for_next_level = slc.trades_needed,
  estimated_trades_to_master = GREATEST(0, 50000 - slc.winning_trades),
  estimated_trades_to_exceptional = GREATEST(0, 100000 - slc.winning_trades),
  last_trade_analyzed_date = now(),
  updated_at = now()
FROM skill_level_calc slc
WHERE sp.user_id = slc.user_id;

-- Step 3: Log the backfill operation
DO $$
DECLARE
  affected_users integer;
  total_winning_trades integer;
  avg_win_rate numeric;
BEGIN
  SELECT COUNT(DISTINCT user_id), SUM(winning_trades), AVG(win_rate)
  INTO affected_users, total_winning_trades, avg_win_rate
  FROM (
    SELECT
      user_id,
      COUNT(*) FILTER (WHERE outcome = 'win') as winning_trades,
      ROUND(100.0 * COUNT(*) FILTER (WHERE outcome = 'win') / NULLIF(COUNT(*), 0), 2) as win_rate
    FROM ai_trade_analysis
    WHERE created_at >= CURRENT_DATE - INTERVAL '90 days'
    GROUP BY user_id
  ) stats;

  RAISE NOTICE 'Skill Progression Backfill Complete:';
  RAISE NOTICE '  Users Updated: %', affected_users;
  RAISE NOTICE '  Total Winning Trades Recovered: %', total_winning_trades;
  RAISE NOTICE '  Average Win Rate: %', avg_win_rate;
END $$;
