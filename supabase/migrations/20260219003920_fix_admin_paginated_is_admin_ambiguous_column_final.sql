/*
  # Fix admin_get_all_users_paginated: is_admin ambiguous column reference

  ## Problem
  PostgreSQL PL/pgSQL creates an implicit output variable for every column
  declared in RETURNS TABLE(...). The output variable `is_admin` conflicts
  with the table column `up.is_admin` inside the function body, causing:
    "column reference 'is_admin' is ambiguous"

  ## Fix
  Rename the RETURNS TABLE output column from `is_admin` to `user_is_admin`
  and alias `up.is_admin AS user_is_admin` in the SELECT. The service layer
  maps `user_is_admin` back to `is_admin` so all frontend consumers are unaffected.
*/

DROP FUNCTION IF EXISTS admin_get_all_users_paginated(text, integer, integer);

CREATE OR REPLACE FUNCTION admin_get_all_users_paginated(
  search_email text DEFAULT NULL,
  page_size integer DEFAULT 20,
  page_offset integer DEFAULT 0
)
RETURNS TABLE(
  user_id uuid,
  email text,
  created_at timestamptz,
  user_is_admin boolean,
  account_balance numeric,
  credit_balance numeric,
  total_trades bigint,
  winning_trades bigint,
  losing_trades bigint,
  tp1_wins bigint,
  tp2_wins bigint,
  manual_closed bigint,
  active_trades bigint,
  active_trades_detail jsonb,
  scanning_sessions bigint,
  scanning_duration_minutes numeric,
  awaiting_response_sessions bigint,
  prompt_risk text,
  trade_style text,
  dollar_risk numeric,
  last_activity timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  calling_user_id uuid;
BEGIN
  calling_user_id := auth.uid();

  IF NOT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = calling_user_id AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    up.id,
    up.email,
    up.created_at,
    up.is_admin AS user_is_admin,
    up.account_balance,
    COALESCE(utb.balance, 0),

    COALESCE(ts.total_trades, 0),
    COALESCE(ts.winning_trades, 0),
    COALESCE(ts.losing_trades, 0),
    COALESCE(ts.tp1_wins, 0),
    COALESCE(ts.tp2_wins, 0),
    COALESCE(ts.manual_closed, 0),

    COALESCE(ts.active_trades, 0),
    COALESCE(at.trades_json, '[]'::jsonb),

    COALESCE(ss.scanning_count, 0),
    ss.scanning_duration_mins,
    COALESCE(ss.awaiting_count, 0),
    ss.risk_mode,

    COALESCE(ss.trade_style, rs.trade_style),
    COALESCE(ss.dollar_risk, rs.dollar_risk),

    GREATEST(
      up.created_at,
      COALESCE(ts.last_trade_time, up.created_at),
      COALESCE(ss.last_session_time, up.created_at)
    )

  FROM user_profiles up
  LEFT JOIN user_token_balance utb ON utb.user_id = up.id

  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) FILTER (WHERE gst.status = 'closed') as total_trades,
      COUNT(*) FILTER (WHERE gst.status = 'closed' AND gst.profit_loss > 0) as winning_trades,
      COUNT(*) FILTER (WHERE gst.status = 'closed' AND gst.profit_loss <= 0) as losing_trades,
      COUNT(*) FILTER (
        WHERE gst.status = 'closed'
        AND LOWER(COALESCE(gst.close_reason, '')) IN ('take_profit_1', 'tp1')
      ) as tp1_wins,
      COUNT(*) FILTER (
        WHERE gst.status = 'closed'
        AND LOWER(COALESCE(gst.close_reason, '')) IN ('take_profit_2', 'tp2', 'take_profit', 'goal_achieved')
      ) as tp2_wins,
      COUNT(*) FILTER (
        WHERE gst.status = 'closed'
        AND LOWER(COALESCE(gst.close_reason, '')) = 'manual'
      ) as manual_closed,
      COUNT(*) FILTER (WHERE gst.status = 'open') as active_trades,
      MAX(gst.created_at) as last_trade_time
    FROM goal_session_trades gst
    WHERE gst.user_id = up.id
  ) ts ON true

  LEFT JOIN LATERAL (
    SELECT
      jsonb_agg(
        jsonb_build_object(
          'symbol', t.symbol,
          'pnl', COALESCE(t.live_pnl, 0),
          'direction', t.direction,
          'entry_price', t.entry_price,
          'current_price', COALESCE(t.live_price, t.entry_price)
        )
        ORDER BY t.trade_created_at DESC
      ) as trades_json
    FROM (
      SELECT
        gst.symbol,
        gst.direction,
        gst.entry_price,
        gst.position_size,
        gst.created_at as trade_created_at,
        CASE
          WHEN gst.direction = 'buy' THEN lp.bid
          ELSE lp.ask
        END as live_price,
        calculate_pnl_universal(
          gst.symbol,
          gst.direction,
          gst.entry_price,
          CASE
            WHEN gst.direction = 'buy' THEN COALESCE(lp.bid, gst.entry_price)
            ELSE COALESCE(lp.ask, gst.entry_price)
          END,
          COALESCE(gst.position_size, 0.01)
        ) as live_pnl
      FROM goal_session_trades gst
      LEFT JOIN LATERAL (
        SELECT rp.bid, rp.ask
        FROM realtime_prices rp
        WHERE rp.symbol = gst.symbol
        ORDER BY rp.created_at DESC
        LIMIT 1
      ) lp ON true
      WHERE gst.user_id = up.id
      AND gst.status = 'open'
      ORDER BY gst.created_at DESC
      LIMIT 10
    ) t
  ) at ON true

  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) FILTER (WHERE gs.status = 'scanning') as scanning_count,
      COUNT(*) FILTER (WHERE gs.status = 'awaiting_response') as awaiting_count,
      MAX(gs.created_at) as last_session_time,
      EXTRACT(EPOCH FROM (NOW() - MIN(gs.updated_at) FILTER (WHERE gs.status = 'scanning'))) / 60 as scanning_duration_mins,
      (
        SELECT gs2.risk_mode
        FROM goal_sessions gs2
        WHERE gs2.user_id = up.id AND gs2.status = 'scanning'
        ORDER BY gs2.updated_at DESC
        LIMIT 1
      ) as risk_mode,
      (
        SELECT gs3.trade_style
        FROM goal_sessions gs3
        WHERE gs3.user_id = up.id
        AND gs3.status IN ('scanning', 'in_trade')
        ORDER BY gs3.updated_at DESC
        LIMIT 1
      ) as trade_style,
      (
        SELECT gs4.dollar_risk
        FROM goal_sessions gs4
        WHERE gs4.user_id = up.id
        AND gs4.status IN ('scanning', 'in_trade')
        ORDER BY gs4.updated_at DESC
        LIMIT 1
      ) as dollar_risk
    FROM goal_sessions gs
    WHERE gs.user_id = up.id
  ) ss ON true

  LEFT JOIN LATERAL (
    SELECT
      gs5.trade_style,
      gs5.dollar_risk
    FROM goal_sessions gs5
    WHERE gs5.user_id = up.id
    ORDER BY gs5.updated_at DESC
    LIMIT 1
  ) rs ON true

  WHERE (search_email IS NULL OR up.email ILIKE '%' || search_email || '%')

  ORDER BY
    CASE WHEN COALESCE(ts.active_trades, 0) > 0 THEN 0 ELSE 1 END,
    CASE WHEN COALESCE(ss.scanning_count, 0) > 0 THEN 0 ELSE 1 END,
    GREATEST(
      up.created_at,
      COALESCE(ts.last_trade_time, up.created_at),
      COALESCE(ss.last_session_time, up.created_at)
    ) DESC

  LIMIT page_size
  OFFSET page_offset;
END;
$$;
