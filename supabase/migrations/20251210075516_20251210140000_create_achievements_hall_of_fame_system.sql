/*
  # Achievements Hall of Fame System

  1. Database Functions
    - Create function to fetch all achieved goals for a user
    - Include session details, trades count, duration, and achievement date
    - Calculate medal tier based on total goals achieved

  2. Helper Views
    - Create view for easy querying of achievement data

  3. Features
    - Medal progression: Bronze (1-10), Silver (11-25), Gold (26-100), Diamond (101-250), Platinum (256-1000)
    - Achievement tracking and display
    - Sharing capabilities support
*/

-- ============================================================================
-- STEP 1: Create function to get user's achievement rank
-- ============================================================================

CREATE OR REPLACE FUNCTION get_user_achievement_rank(p_user_id uuid, p_total_goals_achieved int)
RETURNS TABLE (
  rank_name text,
  rank_color text,
  rank_icon text,
  goals_in_tier int,
  next_tier_name text,
  goals_to_next_tier int
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    CASE
      WHEN p_total_goals_achieved >= 256 THEN 'Platinum'
      WHEN p_total_goals_achieved >= 101 THEN 'Diamond'
      WHEN p_total_goals_achieved >= 26 THEN 'Gold'
      WHEN p_total_goals_achieved >= 11 THEN 'Silver'
      ELSE 'Bronze'
    END as rank_name,
    CASE
      WHEN p_total_goals_achieved >= 256 THEN '#E5E4E2'
      WHEN p_total_goals_achieved >= 101 THEN '#B9F2FF'
      WHEN p_total_goals_achieved >= 26 THEN '#FFD700'
      WHEN p_total_goals_achieved >= 11 THEN '#C0C0C0'
      ELSE '#CD7F32'
    END as rank_color,
    CASE
      WHEN p_total_goals_achieved >= 256 THEN 'trophy'
      WHEN p_total_goals_achieved >= 101 THEN 'gem'
      WHEN p_total_goals_achieved >= 26 THEN 'medal'
      WHEN p_total_goals_achieved >= 11 THEN 'award'
      ELSE 'shield'
    END as rank_icon,
    p_total_goals_achieved as goals_in_tier,
    CASE
      WHEN p_total_goals_achieved >= 1000 THEN 'Maximum'
      WHEN p_total_goals_achieved >= 256 THEN 'Maximum'
      WHEN p_total_goals_achieved >= 101 THEN 'Platinum'
      WHEN p_total_goals_achieved >= 26 THEN 'Diamond'
      WHEN p_total_goals_achieved >= 11 THEN 'Gold'
      ELSE 'Silver'
    END as next_tier_name,
    CASE
      WHEN p_total_goals_achieved >= 1000 THEN 0
      WHEN p_total_goals_achieved >= 256 THEN 0
      WHEN p_total_goals_achieved >= 101 THEN 256 - p_total_goals_achieved
      WHEN p_total_goals_achieved >= 26 THEN 101 - p_total_goals_achieved
      WHEN p_total_goals_achieved >= 11 THEN 26 - p_total_goals_achieved
      ELSE 11 - p_total_goals_achieved
    END as goals_to_next_tier;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- STEP 2: Create function to fetch all achievements for a user
-- ============================================================================

CREATE OR REPLACE FUNCTION get_user_achievements(p_user_id uuid)
RETURNS TABLE (
  achievement_id uuid,
  session_id uuid,
  achievement_number int,
  goal_type text,
  target_value numeric,
  timeframe text,
  final_profit numeric,
  total_trades int,
  winning_trades int,
  losing_trades int,
  win_rate numeric,
  session_duration_hours numeric,
  achieved_at timestamptz,
  medal_rank text,
  medal_color text,
  best_trade_symbol text,
  best_trade_profit numeric,
  risk_mode text
) AS $$
BEGIN
  RETURN QUERY
  WITH ranked_achievements AS (
    SELECT
      gs.id as session_id,
      ROW_NUMBER() OVER (ORDER BY gs.goal_achieved_at ASC) as achievement_number,
      gs.goal_type,
      gs.target_value,
      gs.timeframe,
      gs.goal_achieved_pnl as final_profit,
      gs.goal_achieved_at as achieved_at,
      gs.risk_mode,
      COALESCE(gss.total_trades, 0) as total_trades,
      COALESCE(gss.winning_trades, 0) as winning_trades,
      COALESCE(gss.losing_trades, 0) as losing_trades,
      COALESCE(gss.win_rate, 0) as win_rate,
      COALESCE(gss.session_duration_hours, 0) as session_duration_hours,
      COALESCE((gss.best_trade->>'symbol')::text, '') as best_trade_symbol,
      COALESCE((gss.best_trade->>'profit')::numeric, 0) as best_trade_profit
    FROM goal_sessions gs
    LEFT JOIN goal_session_summaries gss ON gs.id = gss.goal_session_id
    WHERE gs.user_id = p_user_id
    AND gs.status = 'goal_achieved'
    AND gs.goal_achieved_at IS NOT NULL
    ORDER BY gs.goal_achieved_at DESC
  )
  SELECT
    gen_random_uuid() as achievement_id,
    ra.session_id,
    ra.achievement_number::int,
    ra.goal_type,
    ra.target_value,
    ra.timeframe,
    ra.final_profit,
    ra.total_trades::int,
    ra.winning_trades::int,
    ra.losing_trades::int,
    ra.win_rate,
    ra.session_duration_hours,
    ra.achieved_at,
    CASE
      WHEN ra.achievement_number >= 256 THEN 'Platinum'
      WHEN ra.achievement_number >= 101 THEN 'Diamond'
      WHEN ra.achievement_number >= 26 THEN 'Gold'
      WHEN ra.achievement_number >= 11 THEN 'Silver'
      ELSE 'Bronze'
    END as medal_rank,
    CASE
      WHEN ra.achievement_number >= 256 THEN '#E5E4E2'
      WHEN ra.achievement_number >= 101 THEN '#B9F2FF'
      WHEN ra.achievement_number >= 26 THEN '#FFD700'
      WHEN ra.achievement_number >= 11 THEN '#C0C0C0'
      ELSE '#CD7F32'
    END as medal_color,
    ra.best_trade_symbol,
    ra.best_trade_profit,
    ra.risk_mode
  FROM ranked_achievements ra;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- STEP 3: Create summary stats function
-- ============================================================================

CREATE OR REPLACE FUNCTION get_achievement_summary(p_user_id uuid)
RETURNS TABLE (
  total_goals_achieved int,
  total_profit numeric,
  best_goal_amount numeric,
  average_trades_per_goal numeric,
  total_session_hours numeric,
  current_rank text,
  current_rank_color text,
  goals_to_next_rank int
) AS $$
DECLARE
  v_total_goals int;
BEGIN
  -- Get total goals achieved
  SELECT COUNT(*)::int INTO v_total_goals
  FROM goal_sessions
  WHERE user_id = p_user_id
  AND status = 'goal_achieved';

  RETURN QUERY
  SELECT
    v_total_goals as total_goals_achieved,
    COALESCE(SUM(gs.goal_achieved_pnl), 0) as total_profit,
    COALESCE(MAX(gs.target_value), 0) as best_goal_amount,
    CASE
      WHEN COUNT(*) > 0 THEN COALESCE(AVG(gss.total_trades), 0)
      ELSE 0
    END as average_trades_per_goal,
    COALESCE(SUM(gss.session_duration_hours), 0) as total_session_hours,
    (SELECT rank_name FROM get_user_achievement_rank(p_user_id, v_total_goals)) as current_rank,
    (SELECT rank_color FROM get_user_achievement_rank(p_user_id, v_total_goals)) as current_rank_color,
    (SELECT goals_to_next_tier FROM get_user_achievement_rank(p_user_id, v_total_goals)) as goals_to_next_rank
  FROM goal_sessions gs
  LEFT JOIN goal_session_summaries gss ON gs.id = gss.goal_session_id
  WHERE gs.user_id = p_user_id
  AND gs.status = 'goal_achieved';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;