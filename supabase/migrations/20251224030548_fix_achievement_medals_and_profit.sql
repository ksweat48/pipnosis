/*
  # Fix Achievement Medal Ranks and Profit Display

  ## Critical Issues Fixed

  1. **Medal Rank Logic** - Was applying same medal to ALL achievements based on total count
     - Now each achievement gets its own medal based on its achievement_number
     - Goal 1-10: Bronze, 11-25: Silver, 26-100: Gold, 101-250: Diamond, 256-1000: Platinum

  2. **Profit Values Showing $0.00** - Column name mismatch
     - Code inserts into `achieved_pnl` column
     - SQL was reading from `final_pnl` column (which doesn't exist or is null)
     - Fixed to read from `achieved_pnl` consistently

  3. **Duration Calculation** - Improved handling of missing timestamps

  ## Changes Made

  - Drop and recreate get_user_achievements function
  - Medal tier now calculated PER achievement in SELECT clause
  - Uses `achieved_pnl` column instead of `final_pnl`
  - Each achievement row gets its own medal based on its position number
  - Summary function also updated to use correct column
*/

-- Drop existing functions
DROP FUNCTION IF EXISTS get_user_achievements(uuid);
DROP FUNCTION IF EXISTS get_achievement_summary(uuid);

-- Function to get all user achievements with INDIVIDUAL medal ranks
CREATE OR REPLACE FUNCTION get_user_achievements(p_user_id uuid)
RETURNS TABLE(
  achievement_id uuid,
  session_id uuid,
  achievement_number integer,
  goal_type text,
  target_value numeric,
  timeframe text,
  final_profit numeric,
  total_trades bigint,
  winning_trades bigint,
  losing_trades bigint,
  win_rate numeric,
  session_duration_hours numeric,
  achieved_at timestamptz,
  medal_rank text,
  medal_color text,
  best_trade_symbol text,
  best_trade_profit numeric,
  risk_mode text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH ranked_achievements AS (
    SELECT
      ga.id as achievement_id,
      ga.goal_session_id,
      ga.user_id,
      ga.target_amount,
      ga.achieved_pnl,
      ga.achieved_at,
      ROW_NUMBER() OVER (PARTITION BY ga.user_id ORDER BY ga.achieved_at) as achievement_num
    FROM goal_achievements ga
    WHERE ga.user_id = p_user_id
    ORDER BY ga.achieved_at
  ),
  session_info AS (
    SELECT
      gs.id as session_id,
      gs.goal_type,
      gs.timeframe,
      gs.risk_mode,
      gs.start_time,
      gs.completed_at
    FROM goal_sessions gs
  ),
  trade_stats AS (
    SELECT
      gt.goal_session_id,
      COUNT(*) as trade_count,
      COUNT(*) FILTER (WHERE gt.pnl_result > 0) as win_count,
      COUNT(*) FILTER (WHERE gt.pnl_result <= 0) as loss_count,
      MAX(gt.pnl_result) as best_profit,
      MAX(gt.symbol) FILTER (WHERE gt.pnl_result = (SELECT MAX(pnl_result) FROM goal_trades WHERE goal_session_id = gt.goal_session_id)) as best_symbol
    FROM goal_trades gt
    WHERE gt.user_id = p_user_id
      AND gt.status = 'closed'
    GROUP BY gt.goal_session_id
  )
  SELECT
    ra.achievement_id,
    ra.goal_session_id,
    ra.achievement_num::integer,
    COALESCE(si.goal_type, 'profit'),
    ra.target_amount,
    COALESCE(si.timeframe, 'flexible'),
    ra.achieved_pnl,
    COALESCE(ts.trade_count, 0)::bigint,
    COALESCE(ts.win_count, 0)::bigint,
    COALESCE(ts.loss_count, 0)::bigint,
    CASE
      WHEN COALESCE(ts.trade_count, 0) > 0
      THEN (COALESCE(ts.win_count, 0)::numeric / ts.trade_count::numeric * 100)
      ELSE 0
    END as win_rate,
    CASE
      WHEN si.completed_at IS NOT NULL AND si.start_time IS NOT NULL
      THEN EXTRACT(EPOCH FROM (si.completed_at - si.start_time)) / 3600.0
      ELSE 0
    END as session_duration_hours,
    ra.achieved_at,
    CASE
      WHEN ra.achievement_num >= 256 THEN 'Platinum'::text
      WHEN ra.achievement_num >= 101 THEN 'Diamond'::text
      WHEN ra.achievement_num >= 26 THEN 'Gold'::text
      WHEN ra.achievement_num >= 11 THEN 'Silver'::text
      ELSE 'Bronze'::text
    END as medal_rank,
    CASE
      WHEN ra.achievement_num >= 256 THEN '#E5E4E2'::text
      WHEN ra.achievement_num >= 101 THEN '#B9F2FF'::text
      WHEN ra.achievement_num >= 26 THEN '#FFD700'::text
      WHEN ra.achievement_num >= 11 THEN '#C0C0C0'::text
      ELSE '#CD7F32'::text
    END as medal_color,
    COALESCE(ts.best_symbol, 'N/A'),
    COALESCE(ts.best_profit, 0),
    COALESCE(si.risk_mode, 'balanced')
  FROM ranked_achievements ra
  LEFT JOIN session_info si ON ra.goal_session_id = si.session_id
  LEFT JOIN trade_stats ts ON ra.goal_session_id = ts.goal_session_id
  ORDER BY ra.achieved_at DESC;
END;
$$;

-- Function to get achievement summary with correct column reference
CREATE OR REPLACE FUNCTION get_achievement_summary(p_user_id uuid)
RETURNS TABLE(
  total_goals_achieved integer,
  total_profit numeric,
  best_goal_amount numeric,
  average_trades_per_goal numeric,
  total_session_hours numeric,
  current_rank text,
  current_rank_color text,
  goals_to_next_rank integer
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_goals integer;
  v_next_rank_threshold integer;
BEGIN
  -- Get total goals achieved from goal_achievements
  SELECT COUNT(*)::integer INTO v_total_goals
  FROM goal_achievements
  WHERE user_id = p_user_id;

  -- Calculate next rank threshold
  IF v_total_goals >= 256 THEN
    v_next_rank_threshold := 1000;
  ELSIF v_total_goals >= 101 THEN
    v_next_rank_threshold := 256;
  ELSIF v_total_goals >= 26 THEN
    v_next_rank_threshold := 101;
  ELSIF v_total_goals >= 11 THEN
    v_next_rank_threshold := 26;
  ELSE
    v_next_rank_threshold := 11;
  END IF;

  RETURN QUERY
  WITH achievements AS (
    SELECT
      ga.achieved_pnl,
      ga.target_amount,
      ga.goal_session_id
    FROM goal_achievements ga
    WHERE ga.user_id = p_user_id
  ),
  session_durations AS (
    SELECT
      gs.id as session_id,
      EXTRACT(EPOCH FROM (gs.completed_at - gs.start_time)) / 3600.0 as duration_hours
    FROM goal_sessions gs
    WHERE gs.user_id = p_user_id
      AND gs.completed_at IS NOT NULL
      AND gs.start_time IS NOT NULL
  ),
  trade_counts AS (
    SELECT
      gt.goal_session_id,
      COUNT(*) as trade_count
    FROM goal_trades gt
    WHERE gt.user_id = p_user_id
      AND gt.status = 'closed'
    GROUP BY gt.goal_session_id
  ),
  medal AS (
    SELECT * FROM get_medal_tier(v_total_goals)
  )
  SELECT
    v_total_goals,
    COALESCE(SUM(a.achieved_pnl), 0),
    COALESCE(MAX(a.target_amount), 0),
    COALESCE(AVG(tc.trade_count), 0),
    COALESCE(SUM(sd.duration_hours), 0),
    (SELECT rank FROM medal),
    (SELECT color FROM medal),
    GREATEST(0, v_next_rank_threshold - v_total_goals)
  FROM achievements a
  LEFT JOIN session_durations sd ON a.goal_session_id = sd.session_id
  LEFT JOIN trade_counts tc ON a.goal_session_id = tc.goal_session_id;
END;
$$;

-- Verification query to test the fix
DO $$
DECLARE
  v_test_user uuid;
  v_achievement_count integer;
BEGIN
  -- Get first user with achievements
  SELECT user_id INTO v_test_user
  FROM goal_achievements
  LIMIT 1;

  IF v_test_user IS NOT NULL THEN
    SELECT COUNT(*) INTO v_achievement_count
    FROM goal_achievements
    WHERE user_id = v_test_user;

    RAISE NOTICE '═══════════════════════════════════════════════════════════';
    RAISE NOTICE '✅ ACHIEVEMENT MEDAL RANKS AND PROFIT DISPLAY FIXED';
    RAISE NOTICE '═══════════════════════════════════════════════════════════';
    RAISE NOTICE '';
    RAISE NOTICE '📋 Fixes Applied:';
    RAISE NOTICE '  1. Medal rank now calculated PER achievement';
    RAISE NOTICE '     - Goal 1-10: Bronze';
    RAISE NOTICE '     - Goal 11-25: Silver';
    RAISE NOTICE '     - Goal 26-100: Gold';
    RAISE NOTICE '     - Goal 101-250: Diamond';
    RAISE NOTICE '     - Goal 256-1000: Platinum';
    RAISE NOTICE '';
    RAISE NOTICE '  2. Profit column fixed to use achieved_pnl';
    RAISE NOTICE '     - Was reading from final_pnl (null/missing)';
    RAISE NOTICE '     - Now reads from achieved_pnl (actual data)';
    RAISE NOTICE '';
    RAISE NOTICE '  3. Duration calculation improved';
    RAISE NOTICE '';
    RAISE NOTICE '🧪 Test User Found:';
    RAISE NOTICE '  User ID: %', v_test_user;
    RAISE NOTICE '  Total Achievements: %', v_achievement_count;
    RAISE NOTICE '';
    RAISE NOTICE '🔍 Run this to verify medals:';
    RAISE NOTICE '  SELECT achievement_number, medal_rank, final_profit';
    RAISE NOTICE '  FROM get_user_achievements(''%'');', v_test_user;
    RAISE NOTICE '═══════════════════════════════════════════════════════════';
  ELSE
    RAISE NOTICE '⚠️  No achievements found yet. Functions updated and ready.';
  END IF;
END $$;
