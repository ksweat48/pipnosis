/*
  # Fix Platform KPIs - SSOT Column Name Compliance

  ## Problem
  - Migration referenced `unrealized_pnl` column which doesn't exist
  - Correct SSOT column name is `current_pnl`
  - Also fixes admin_get_all_users which has same issue

  ## Changes
  1. Fix `admin_get_platform_kpis()` to use `current_pnl`
  2. Fix `admin_get_all_users()` to use `current_pnl`

  ## SSOT Compliance
  - Uses correct column names from goal_session_trades table
  - Maintains referential integrity
*/

-- Fix admin_get_platform_kpis with correct column name
DROP FUNCTION IF EXISTS admin_get_platform_kpis();

CREATE OR REPLACE FUNCTION admin_get_platform_kpis()
RETURNS TABLE (
  total_users bigint,
  active_users bigint,
  total_trades bigint,
  winning_trades bigint,
  losing_trades bigint,
  overall_win_rate numeric,
  total_platform_pnl numeric,
  total_platform_balance numeric,
  open_positions_count bigint,
  total_unrealized_pnl numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  calling_user_id uuid;
BEGIN
  -- Get the calling user's ID
  calling_user_id := auth.uid();

  -- Security check: Only admins can access this function
  IF NOT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = calling_user_id
    AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    -- Total registered users
    (SELECT COUNT(*)::bigint FROM user_profiles) as total_users,

    -- Active users (with trades in last 7 days)
    (
      SELECT COUNT(DISTINCT user_id)::bigint
      FROM goal_session_trades
      WHERE created_at >= NOW() - INTERVAL '7 days'
    ) as active_users,

    -- Total closed trades across platform
    (
      SELECT COUNT(*)::bigint
      FROM goal_session_trades
      WHERE status = 'closed'
    ) as total_trades,

    -- Winning trades (PnL > 0)
    (
      SELECT COUNT(*)::bigint
      FROM goal_session_trades
      WHERE status = 'closed' AND profit_loss > 0
    ) as winning_trades,

    -- Losing trades (PnL <= 0)
    (
      SELECT COUNT(*)::bigint
      FROM goal_session_trades
      WHERE status = 'closed' AND profit_loss <= 0
    ) as losing_trades,

    -- Overall win rate percentage
    (
      SELECT
        CASE
          WHEN COUNT(*) > 0 THEN
            ROUND((COUNT(*) FILTER (WHERE profit_loss > 0)::numeric / COUNT(*)::numeric) * 100, 2)
          ELSE 0
        END
      FROM goal_session_trades
      WHERE status = 'closed'
    ) as overall_win_rate,

    -- Total Platform P&L (sum of all closed trades profit_loss)
    (
      SELECT COALESCE(SUM(profit_loss), 0)
      FROM goal_session_trades
      WHERE status = 'closed'
    ) as total_platform_pnl,

    -- Total Platform Balance (sum of all user account balances)
    (
      SELECT COALESCE(SUM(account_balance), 0)
      FROM user_profiles
    ) as total_platform_balance,

    -- Open positions count
    (
      SELECT COUNT(*)::bigint
      FROM goal_session_trades
      WHERE status = 'open'
    ) as open_positions_count,

    -- Total unrealized P&L (sum of current_pnl from open trades)
    (
      SELECT COALESCE(SUM(current_pnl), 0)
      FROM goal_session_trades
      WHERE status = 'open'
    ) as total_unrealized_pnl;
END;
$$;

-- Fix admin_get_all_users with correct column name
DROP FUNCTION IF EXISTS admin_get_all_users(text, integer);

CREATE OR REPLACE FUNCTION admin_get_all_users(
  search_email text DEFAULT NULL,
  limit_count integer DEFAULT 100
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
  active_trades bigint,
  active_trades_detail jsonb,
  scanning_sessions bigint,
  scanning_duration_minutes numeric,
  awaiting_response_sessions bigint,
  prompt_risk text,
  last_activity timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  calling_user_id uuid;
BEGIN
  -- Get the calling user's ID
  calling_user_id := auth.uid();

  -- Security check: Only admins can access this function
  IF NOT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = calling_user_id
    AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  WITH user_stats AS (
    SELECT
      up.id,
      up.email,
      up.created_at,
      up.is_admin,
      up.account_balance,
      tb.balance as credit_balance,

      -- Trade statistics
      COALESCE(COUNT(DISTINCT gst.id) FILTER (WHERE gst.status = 'closed'), 0) as total_trades_count,
      COALESCE(COUNT(DISTINCT gst.id) FILTER (WHERE gst.status = 'closed' AND gst.profit_loss > 0), 0) as winning_trades_count,
      COALESCE(COUNT(DISTINCT gst.id) FILTER (WHERE gst.status = 'closed' AND gst.profit_loss <= 0), 0) as losing_trades_count,

      -- Active trades
      COALESCE(COUNT(DISTINCT gst.id) FILTER (WHERE gst.status = 'open'), 0) as active_trades_count,

      -- Active trades detail with real-time PnL using current_pnl
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'symbol', gst.symbol,
            'pnl', COALESCE(gst.current_pnl, 0),
            'direction', gst.direction,
            'entry_price', gst.entry_price,
            'current_price', COALESCE(rp.price, gst.current_price, gst.entry_price)
          )
          ORDER BY gst.created_at DESC
        ) FILTER (WHERE gst.status = 'open'),
        '[]'::jsonb
      ) as active_trades_detail_json,

      -- Goal sessions
      COALESCE(COUNT(DISTINCT gs.id) FILTER (WHERE gs.status = 'scanning'), 0) as scanning_sessions_count,
      COALESCE(
        EXTRACT(EPOCH FROM (NOW() - MIN(gs.updated_at) FILTER (WHERE gs.status = 'scanning'))) / 60,
        NULL
      ) as scanning_duration_mins,
      COALESCE(COUNT(DISTINCT gs.id) FILTER (WHERE gs.status = 'awaiting_response'), 0) as awaiting_response_count,

      -- Get risk mode from the most recent scanning session
      (
        SELECT gs_inner.risk_mode
        FROM goal_sessions gs_inner
        WHERE gs_inner.user_id = up.id
          AND gs_inner.status = 'scanning'
        ORDER BY gs_inner.updated_at DESC
        LIMIT 1
      ) as session_risk_mode,

      -- Last activity
      GREATEST(
        up.created_at,
        COALESCE(MAX(gst.created_at), up.created_at),
        COALESCE(MAX(gs.created_at), up.created_at)
      ) as last_activity_time

    FROM user_profiles up
    LEFT JOIN token_balances tb ON tb.user_id = up.id
    LEFT JOIN goal_session_trades gst ON gst.user_id = up.id
    LEFT JOIN goal_sessions gs ON gs.user_id = up.id
    LEFT JOIN realtime_prices rp ON rp.symbol = gst.symbol
    WHERE
      (search_email IS NULL OR up.email ILIKE '%' || search_email || '%')
    GROUP BY up.id, up.email, up.created_at, up.is_admin, up.account_balance, tb.balance
    ORDER BY last_activity_time DESC
    LIMIT limit_count
  )
  SELECT
    us.id as user_id,
    us.email,
    us.created_at,
    us.is_admin,
    us.account_balance,
    us.credit_balance,
    us.total_trades_count as total_trades,
    us.winning_trades_count as winning_trades,
    us.losing_trades_count as losing_trades,
    us.active_trades_count as active_trades,
    us.active_trades_detail_json as active_trades_detail,
    us.scanning_sessions_count as scanning_sessions,
    us.scanning_duration_mins as scanning_duration_minutes,
    us.awaiting_response_count as awaiting_response_sessions,
    us.session_risk_mode as prompt_risk,
    us.last_activity_time as last_activity
  FROM user_stats us;
END;
$$;

-- Grant execute permissions to authenticated users (admin check is inside functions)
GRANT EXECUTE ON FUNCTION admin_get_all_users(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_get_platform_kpis() TO authenticated;
