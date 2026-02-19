/*
  # Admin Users: TP1/TP2/MC Trade Breakdown + Trade Style/Risk

  ## Summary
  Enhances the admin_get_all_users_paginated RPC to return:
  1. tp1_wins - trades closed via take_profit_1/tp1
  2. tp2_wins - trades closed via take_profit_2/tp2/take_profit/goal_achieved
  3. manual_closed - trades closed manually (close_reason = 'manual')
  4. trade_style - the user's current/most recent session trade style (scalper/day/swing)
  5. dollar_risk - the user's current/most recent session dollar risk amount

  ## Changes
  - DROP and RECREATE admin_get_all_users_paginated with 5 new output columns
  - Trade style and dollar risk come from the most recent active or recent session
  - TP/MC breakdown uses close_reason column on goal_session_trades
*/

-- Drop the old function signature first
DROP FUNCTION IF EXISTS admin_get_all_users_paginated(text, integer, integer);

CREATE OR REPLACE FUNCTION admin_get_all_users_paginated(
  search_email text DEFAULT NULL,
  page_size integer DEFAULT 20,
  page_offset integer DEFAULT 0
)
RETURNS TABLE (
  user_id uuid,
  email text,
  created_at timestamptz,
  is_admin boolean,
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
SET search_path = public
SET statement_timeout = '30s'
AS $$
DECLARE
  calling_user_id uuid;
BEGIN
  -- Security check: Only admins can view user list
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
    up.is_admin,
    up.account_balance,
    COALESCE(utb.balance, 0),

    -- Closed trades count
    COALESCE(ts.total_trades, 0),
    COALESCE(ts.winning_trades, 0),
    COALESCE(ts.losing_trades, 0),

    -- TP1 wins (take_profit_1 or tp1)
    COALESCE(ts.tp1_wins, 0),
    -- TP2 wins (take_profit_2, tp2, take_profit, goal_achieved)
    COALESCE(ts.tp2_wins, 0),
    -- Manually closed (close_reason = 'manual')
    COALESCE(ts.manual_closed, 0),

    -- Active trades count
    COALESCE(ts.active_trades, 0),

    -- Active trades detail with LIVE P&L calculation
    COALESCE(at.trades_json, '[]'::jsonb),

    -- Scanning sessions
    COALESCE(ss.scanning_count, 0),
    ss.scanning_duration_mins,
    COALESCE(ss.awaiting_count, 0),
    ss.risk_mode,

    -- Trade style and dollar risk from most recent session
    COALESCE(ss.trade_style, rs.trade_style),
    COALESCE(ss.dollar_risk, rs.dollar_risk),

    -- Last activity
    GREATEST(
      up.created_at,
      COALESCE(ts.last_trade_time, up.created_at),
      COALESCE(ss.last_session_time, up.created_at)
    )

  FROM user_profiles up
  LEFT JOIN user_token_balance utb ON utb.user_id = up.id

  -- Trade statistics (closed trades only)
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) FILTER (WHERE status = 'closed') as total_trades,
      COUNT(*) FILTER (WHERE status = 'closed' AND profit_loss > 0) as winning_trades,
      COUNT(*) FILTER (WHERE status = 'closed' AND profit_loss <= 0) as losing_trades,
      -- TP1: take_profit_1 or tp1
      COUNT(*) FILTER (
        WHERE status = 'closed'
        AND LOWER(COALESCE(close_reason, '')) IN ('take_profit_1', 'tp1')
      ) as tp1_wins,
      -- TP2: take_profit_2, tp2, take_profit, goal_achieved
      COUNT(*) FILTER (
        WHERE status = 'closed'
        AND LOWER(COALESCE(close_reason, '')) IN ('take_profit_2', 'tp2', 'take_profit', 'goal_achieved')
      ) as tp2_wins,
      -- Manually closed
      COUNT(*) FILTER (
        WHERE status = 'closed'
        AND LOWER(COALESCE(close_reason, '')) = 'manual'
      ) as manual_closed,
      COUNT(*) FILTER (WHERE status = 'open') as active_trades,
      MAX(created_at) as last_trade_time
    FROM goal_session_trades
    WHERE user_id = up.id
  ) ts ON true

  -- Active trades with LIVE P&L from realtime_prices
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

  -- Session statistics (current active/scanning sessions)
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) FILTER (WHERE status = 'scanning') as scanning_count,
      COUNT(*) FILTER (WHERE status = 'awaiting_response') as awaiting_count,
      MAX(created_at) as last_session_time,
      EXTRACT(EPOCH FROM (NOW() - MIN(updated_at) FILTER (WHERE status = 'scanning'))) / 60 as scanning_duration_mins,
      (
        SELECT gs2.risk_mode
        FROM goal_sessions gs2
        WHERE gs2.user_id = up.id AND gs2.status = 'scanning'
        ORDER BY gs2.updated_at DESC
        LIMIT 1
      ) as risk_mode,
      -- Trade style from most recent active session (scanning or in_trade)
      (
        SELECT gs3.trade_style
        FROM goal_sessions gs3
        WHERE gs3.user_id = up.id
          AND gs3.status IN ('scanning', 'in_trade')
        ORDER BY gs3.updated_at DESC
        LIMIT 1
      ) as trade_style,
      -- Dollar risk from most recent active session
      (
        SELECT gs4.dollar_risk
        FROM goal_sessions gs4
        WHERE gs4.user_id = up.id
          AND gs4.status IN ('scanning', 'in_trade')
        ORDER BY gs4.updated_at DESC
        LIMIT 1
      ) as dollar_risk
    FROM goal_sessions
    WHERE user_id = up.id
  ) ss ON true

  -- Fallback: trade style/risk from most recent completed session (when no active session)
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

GRANT EXECUTE ON FUNCTION admin_get_all_users_paginated(text, integer, integer) TO authenticated;

COMMENT ON FUNCTION admin_get_all_users_paginated IS
  'Paginated admin user list with TP1/TP2/MC trade breakdown and trade style/risk per user.
   Returns tp1_wins, tp2_wins, manual_closed for closed trade breakdown.
   Returns trade_style and dollar_risk from most recent active or recent session.';
