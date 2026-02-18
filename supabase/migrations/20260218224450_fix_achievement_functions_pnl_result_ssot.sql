/*
  # Fix Achievement Functions — SSOT Column Name Correction

  ## Problem
  `get_user_achievements` and `get_achievement_summary` referenced `gst.pnl_result`
  which does not exist on `goal_session_trades`. The authoritative P&L column is
  `profit_loss` (established in the SSOT trading core schema).

  ## Changes
  - `get_user_achievements`: replace all `pnl_result` references with `profit_loss`
  - `get_achievement_summary`: no direct pnl_result use, but rebuilt for safety/consistency

  ## Root Cause (CCIP)
  A prior migration renamed the column from `pnl_result` to `profit_loss` for SSOT
  compliance but the achievement RPC functions were not updated in sync.

  ## Impact
  Fixes 400 Bad Request errors on `/rpc/get_user_achievements` and
  `/rpc/get_achievement_summary` throughout the app.
*/

CREATE OR REPLACE FUNCTION public.get_user_achievements(p_user_id uuid)
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
  achieved_at timestamp with time zone,
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
      ga.id                AS achievement_id,
      ga.goal_session_id,
      ga.user_id,
      ga.target_amount,
      ga.achieved_pnl,
      ga.achieved_at,
      ROW_NUMBER() OVER (PARTITION BY ga.user_id ORDER BY ga.achieved_at) AS achievement_num
    FROM goal_achievements ga
    WHERE ga.user_id = p_user_id
    ORDER BY ga.achieved_at
  ),
  session_info AS (
    SELECT
      gs.id          AS session_id,
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
      COUNT(*)                                              AS trade_count,
      COUNT(*) FILTER (WHERE gst.profit_loss > 0)          AS win_count,
      COUNT(*) FILTER (WHERE gst.profit_loss <= 0)         AS loss_count,
      MAX(gst.profit_loss)                                 AS best_profit,
      MAX(gst.symbol) FILTER (
        WHERE gst.profit_loss = (
          SELECT MAX(inner_gst.profit_loss)
          FROM goal_session_trades inner_gst
          WHERE inner_gst.goal_session_id = gst.goal_session_id
        )
      )                                                     AS best_symbol
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
    COALESCE(ts.win_count,   0)::bigint,
    COALESCE(ts.loss_count,  0)::bigint,
    CASE
      WHEN COALESCE(ts.trade_count, 0) > 0
        THEN (COALESCE(ts.win_count, 0)::numeric / ts.trade_count::numeric * 100)
      ELSE 0
    END                                                   AS win_rate,
    CASE
      WHEN si.completed_at IS NOT NULL AND si.start_time IS NOT NULL
        THEN EXTRACT(EPOCH FROM (si.completed_at - si.start_time)) / 3600.0
      ELSE 0
    END                                                   AS session_duration_hours,
    ra.achieved_at,
    CASE
      WHEN ra.achievement_num >= 256 THEN 'Platinum'::text
      WHEN ra.achievement_num >= 101 THEN 'Diamond'::text
      WHEN ra.achievement_num >=  26 THEN 'Gold'::text
      WHEN ra.achievement_num >=  11 THEN 'Silver'::text
      ELSE                                'Bronze'::text
    END                                                   AS medal_rank,
    CASE
      WHEN ra.achievement_num >= 256 THEN '#E5E4E2'::text
      WHEN ra.achievement_num >= 101 THEN '#B9F2FF'::text
      WHEN ra.achievement_num >=  26 THEN '#FFD700'::text
      WHEN ra.achievement_num >=  11 THEN '#C0C0C0'::text
      ELSE                                '#CD7F32'::text
    END                                                   AS medal_color,
    COALESCE(ts.best_symbol, 'N/A'),
    COALESCE(ts.best_profit, 0),
    COALESCE(si.risk_mode, 'balanced')
  FROM ranked_achievements ra
  LEFT JOIN session_info  si ON ra.goal_session_id = si.session_id
  LEFT JOIN trade_stats   ts ON ra.goal_session_id = ts.goal_session_id
  ORDER BY ra.achieved_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_achievement_summary(p_user_id uuid)
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
      COUNT(*)                        AS total_achievements,
      COALESCE(SUM(achieved_pnl), 0) AS total_profit_sum,
      MAX(target_amount)              AS max_goal_amount,
      COUNT(*)                        AS rank_count
    FROM goal_achievements
    WHERE user_id = p_user_id
  ),
  trade_stats AS (
    SELECT
      COUNT(*)                           AS total_trade_count,
      COUNT(DISTINCT goal_session_id)    AS unique_sessions
    FROM goal_session_trades
    WHERE user_id = p_user_id
      AND status = 'closed'
  ),
  session_duration AS (
    SELECT
      COALESCE(
        SUM(EXTRACT(EPOCH FROM (completed_at - start_time)) / 3600.0),
        0
      ) AS total_hours
    FROM goal_sessions
    WHERE user_id = p_user_id
      AND completed_at IS NOT NULL
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
      WHEN ast.rank_count >=  26 THEN 'Gold'::text
      WHEN ast.rank_count >=  11 THEN 'Silver'::text
      ELSE                            'Bronze'::text
    END,
    CASE
      WHEN ast.rank_count >= 256 THEN '#E5E4E2'::text
      WHEN ast.rank_count >= 101 THEN '#B9F2FF'::text
      WHEN ast.rank_count >=  26 THEN '#FFD700'::text
      WHEN ast.rank_count >=  11 THEN '#C0C0C0'::text
      ELSE                            '#CD7F32'::text
    END,
    CASE
      WHEN ast.rank_count >= 256 THEN 0
      WHEN ast.rank_count >= 101 THEN 256 - ast.rank_count
      WHEN ast.rank_count >=  26 THEN 101 - ast.rank_count
      WHEN ast.rank_count >=  11 THEN  26 - ast.rank_count
      ELSE                             11  - ast.rank_count
    END
  FROM achievement_stats  ast
  CROSS JOIN trade_stats  ts
  CROSS JOIN session_duration sd;
END;
$$;
