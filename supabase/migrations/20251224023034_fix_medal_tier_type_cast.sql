/*
  # Fix Medal Tier Type Cast Issue

  1. Problem
    - get_medal_tier expects integer but COUNT(*) returns bigint
    - Function call fails with type mismatch error
  
  2. Solution
    - Cast COUNT(*) to integer when calling get_medal_tier
    - Update both get_user_achievements and get_achievement_summary functions
*/

-- Drop and recreate with proper type casting
DROP FUNCTION IF EXISTS get_user_achievements(uuid);
DROP FUNCTION IF EXISTS get_achievement_summary(uuid);

-- Function to get all user achievements from goal_achievements table
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
      ga.final_pnl,
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
  ),
  achievement_count AS (
    SELECT COUNT(*)::integer as total_achievements
    FROM ranked_achievements
  ),
  medal_info AS (
    SELECT * FROM get_medal_tier((SELECT total_achievements FROM achievement_count))
  )
  SELECT 
    ra.achievement_id,
    ra.goal_session_id,
    ra.achievement_num::integer,
    COALESCE(si.goal_type, 'profit'),
    ra.target_amount,
    COALESCE(si.timeframe, 'flexible'),
    ra.final_pnl,
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
    (SELECT rank FROM medal_info),
    (SELECT color FROM medal_info),
    COALESCE(ts.best_symbol, 'N/A'),
    COALESCE(ts.best_profit, 0),
    COALESCE(si.risk_mode, 'balanced')
  FROM ranked_achievements ra
  LEFT JOIN session_info si ON ra.goal_session_id = si.session_id
  LEFT JOIN trade_stats ts ON ra.goal_session_id = ts.goal_session_id
  CROSS JOIN medal_info
  ORDER BY ra.achieved_at DESC;
END;
$$;

-- Function to get achievement summary from goal_achievements table
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
  -- Get total goals achieved from goal_achievements (cast to integer)
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
      ga.final_pnl,
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
    COALESCE(SUM(a.final_pnl), 0),
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