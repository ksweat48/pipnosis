/*
  # Fix Achievement Functions - SSOT Table Name Compliance

  ## Critical Bug Found
  
  Achievement functions `get_user_achievements` and `get_achievement_summary` reference
  non-existent table `goal_trades` instead of correct SSOT table `goal_session_trades`.
  
  This causes:
  - 404 errors on function calls
  - Missing achievement display
  - Broken trade statistics queries

  ## Root Cause
  Table was renamed to `goal_session_trades` for SSOT compliance, but achievement 
  functions were not updated. This violates SSOT principle - functions should use 
  authoritative table name.

  ## Changes
  - Drop and recreate both achievement functions
  - Replace ALL `goal_trades` references with `goal_session_trades`
  - Maintain exact same logic, fix only table names
  - Add comments for SSOT compliance

  ## CCIP Compliance
  - System Map: Achievement queries now read from correct SSOT table
  - Logic Contract: No functional changes, only SSOT table names
  - Compatibility: Backward compatible, fixes broken queries
  - Staged: Simple function recreation
  - Verification: Functions will execute without 404 errors
*/

-- Drop broken functions
DROP FUNCTION IF EXISTS get_user_achievements(uuid);
DROP FUNCTION IF EXISTS get_achievement_summary(uuid);

-- Recreate get_user_achievements with correct SSOT table names
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
      gst.goal_session_id,
      COUNT(*) as trade_count,
      COUNT(*) FILTER (WHERE gst.pnl_result > 0) as win_count,
      COUNT(*) FILTER (WHERE gst.pnl_result <= 0) as loss_count,
      MAX(gst.pnl_result) as best_profit,
      MAX(gst.symbol) FILTER (WHERE gst.pnl_result = (SELECT MAX(pnl_result) FROM goal_session_trades WHERE goal_session_id = gst.goal_session_id)) as best_symbol
    FROM goal_session_trades gst
    WHERE gst.user_id = p_user_id
      AND gst.status = 'closed'
    GROUP BY gst.goal_session_id
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

-- Recreate get_achievement_summary with correct SSOT table names
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
BEGIN
  RETURN QUERY
  WITH achievement_stats AS (
    SELECT
      COUNT(*) as total_achievements,
      COALESCE(SUM(achieved_pnl), 0) as total_profit_sum,
      MAX(target_amount) as max_goal_amount,
      COUNT(*) as rank_count
    FROM goal_achievements
    WHERE user_id = p_user_id
  ),
  trade_stats AS (
    SELECT
      COUNT(*) as total_trade_count,
      COUNT(DISTINCT goal_session_id) as unique_sessions
    FROM goal_session_trades
    WHERE user_id = p_user_id AND status = 'closed'
  ),
  session_duration AS (
    SELECT
      COALESCE(SUM(EXTRACT(EPOCH FROM (completed_at - start_time)) / 3600.0), 0) as total_hours
    FROM goal_sessions
    WHERE user_id = p_user_id AND completed_at IS NOT NULL
  )
  SELECT
    COALESCE(ast.total_achievements, 0)::integer,
    ast.total_profit_sum,
    ast.max_goal_amount,
    CASE
      WHEN COALESCE(ast.total_achievements, 0) > 0
      THEN ts.total_trade_count::numeric / ast.total_achievements
      ELSE 0
    END,
    sd.total_hours,
    CASE
      WHEN ast.rank_count >= 256 THEN 'Platinum'::text
      WHEN ast.rank_count >= 101 THEN 'Diamond'::text
      WHEN ast.rank_count >= 26 THEN 'Gold'::text
      WHEN ast.rank_count >= 11 THEN 'Silver'::text
      ELSE 'Bronze'::text
    END,
    CASE
      WHEN ast.rank_count >= 256 THEN '#E5E4E2'::text
      WHEN ast.rank_count >= 101 THEN '#B9F2FF'::text
      WHEN ast.rank_count >= 26 THEN '#FFD700'::text
      WHEN ast.rank_count >= 11 THEN '#C0C0C0'::text
      ELSE '#CD7F32'::text
    END,
    CASE
      WHEN ast.rank_count >= 256 THEN 0
      WHEN ast.rank_count >= 101 THEN 256 - ast.rank_count
      WHEN ast.rank_count >= 26 THEN 101 - ast.rank_count
      WHEN ast.rank_count >= 11 THEN 26 - ast.rank_count
      ELSE 11 - ast.rank_count
    END
  FROM achievement_stats ast
  CROSS JOIN trade_stats ts
  CROSS JOIN session_duration sd;
END;
$$;

-- Grant execution permissions to authenticated users
GRANT EXECUTE ON FUNCTION get_user_achievements(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION get_achievement_summary(uuid) TO authenticated, anon;

SELECT 'Achievement functions fixed - SSOT table name compliance' as migration_note;
