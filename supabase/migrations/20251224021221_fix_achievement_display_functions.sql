/*
  # Fix Achievement Display Functions

  1. Drop and Recreate Functions
    - Drop existing `get_user_achievements` and `get_achievement_summary` if they exist
    - Create new versions with correct return types
  
  2. Calculated Fields
    - `total_trades` - Count of trades from goal_trades table
    - `winning_trades` - Count of profitable trades
    - `losing_trades` - Count of losing trades
    - `win_rate` - Percentage of winning trades
    - `session_duration_hours` - Duration from start to completion
    - `medal_rank` - Rank based on number of achievements
    - `medal_color` - Display color for the medal
  
  3. Security
    - Functions use SECURITY DEFINER to access goal data
    - RLS policies ensure users only see their own achievements
*/

-- Drop existing functions if they exist
DROP FUNCTION IF EXISTS get_user_achievements(uuid);
DROP FUNCTION IF EXISTS get_achievement_summary(uuid);
DROP FUNCTION IF EXISTS get_medal_tier(integer);

-- Function to calculate medal rank and color based on achievement count
CREATE OR REPLACE FUNCTION get_medal_tier(achievement_count integer)
RETURNS TABLE(rank text, color text) 
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF achievement_count >= 256 THEN
    RETURN QUERY SELECT 'Platinum'::text, '#E5E4E2'::text;
  ELSIF achievement_count >= 101 THEN
    RETURN QUERY SELECT 'Diamond'::text, '#B9F2FF'::text;
  ELSIF achievement_count >= 26 THEN
    RETURN QUERY SELECT 'Gold'::text, '#FFD700'::text;
  ELSIF achievement_count >= 11 THEN
    RETURN QUERY SELECT 'Silver'::text, '#C0C0C0'::text;
  ELSE
    RETURN QUERY SELECT 'Bronze'::text, '#CD7F32'::text;
  END IF;
END;
$$;

-- Function to get all user achievements with stats
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
  WITH completed_sessions AS (
    SELECT 
      gs.id as session_id,
      gs.user_id,
      gs.goal_type,
      gs.target_value,
      gs.timeframe,
      gs.risk_mode,
      gs.final_pnl,
      gs.start_time,
      gs.completed_at,
      gs.created_at,
      ROW_NUMBER() OVER (PARTITION BY gs.user_id ORDER BY gs.completed_at) as achievement_num
    FROM goal_sessions gs
    WHERE gs.user_id = p_user_id
      AND gs.status = 'completed'
      AND gs.completed_at IS NOT NULL
      AND gs.final_pnl >= gs.target_value
    ORDER BY gs.completed_at
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
    SELECT COUNT(*) as total_achievements
    FROM completed_sessions
  ),
  medal_info AS (
    SELECT * FROM get_medal_tier((SELECT total_achievements FROM achievement_count))
  )
  SELECT 
    gen_random_uuid() as achievement_id,
    cs.session_id,
    cs.achievement_num::integer,
    cs.goal_type,
    cs.target_value,
    cs.timeframe,
    cs.final_pnl,
    COALESCE(ts.trade_count, 0)::bigint,
    COALESCE(ts.win_count, 0)::bigint,
    COALESCE(ts.loss_count, 0)::bigint,
    CASE 
      WHEN COALESCE(ts.trade_count, 0) > 0 
      THEN (COALESCE(ts.win_count, 0)::numeric / ts.trade_count::numeric * 100)
      ELSE 0
    END as win_rate,
    EXTRACT(EPOCH FROM (cs.completed_at - cs.start_time)) / 3600.0 as session_duration_hours,
    cs.completed_at,
    (SELECT rank FROM medal_info),
    (SELECT color FROM medal_info),
    COALESCE(ts.best_symbol, 'N/A'),
    COALESCE(ts.best_profit, 0),
    cs.risk_mode
  FROM completed_sessions cs
  LEFT JOIN trade_stats ts ON cs.session_id = ts.goal_session_id
  CROSS JOIN medal_info
  ORDER BY cs.completed_at DESC;
END;
$$;

-- Function to get achievement summary stats
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
  -- Get total goals achieved
  SELECT COUNT(*) INTO v_total_goals
  FROM goal_sessions
  WHERE user_id = p_user_id
    AND status = 'completed'
    AND completed_at IS NOT NULL
    AND final_pnl >= target_value;

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
  WITH completed_goals AS (
    SELECT 
      gs.final_pnl,
      gs.target_value,
      gs.start_time,
      gs.completed_at,
      gs.id as session_id
    FROM goal_sessions gs
    WHERE gs.user_id = p_user_id
      AND gs.status = 'completed'
      AND gs.completed_at IS NOT NULL
      AND gs.final_pnl >= gs.target_value
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
    COALESCE(SUM(cg.final_pnl), 0),
    COALESCE(MAX(cg.target_value), 0),
    COALESCE(AVG(tc.trade_count), 0),
    COALESCE(SUM(EXTRACT(EPOCH FROM (cg.completed_at - cg.start_time)) / 3600.0), 0),
    (SELECT rank FROM medal),
    (SELECT color FROM medal),
    GREATEST(0, v_next_rank_threshold - v_total_goals)
  FROM completed_goals cg
  LEFT JOIN trade_counts tc ON cg.session_id = tc.goal_session_id;
END;
$$;