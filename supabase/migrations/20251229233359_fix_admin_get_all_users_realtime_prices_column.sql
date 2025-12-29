/*
  # Fix admin_get_all_users - Realtime Prices Column

  ## Problem
  - Function references `rp.price` which doesn't exist
  - Actual column is `mid` (or `bid`/`ask`) in realtime_prices table

  ## Solution
  - Replace `rp.price` with `rp.mid` for current price
*/

-- Drop existing function
DROP FUNCTION IF EXISTS admin_get_all_users(text, integer);

-- Recreate with correct column name
CREATE OR REPLACE FUNCTION admin_get_all_users(
  search_email text DEFAULT NULL,
  limit_count integer DEFAULT 100
)
RETURNS TABLE (
  user_profile_id uuid,
  user_email text,
  user_created_at timestamptz,
  user_is_admin boolean,
  user_account_balance numeric,
  user_credit_balance numeric,
  total_trades_count bigint,
  winning_trades_count bigint,
  losing_trades_count bigint,
  active_trades_count bigint,
  active_trades_detail_json jsonb,
  scanning_sessions_count bigint,
  scanning_duration_mins numeric,
  awaiting_response_count bigint,
  session_risk_mode text,
  last_activity_time timestamptz
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
    WHERE user_profiles.id = calling_user_id
      AND user_profiles.is_admin = true
  ) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  WITH user_stats AS (
    SELECT
      up.id as user_profile_id,
      up.email as user_email,
      up.created_at as user_created_at,
      up.is_admin as user_is_admin,
      up.account_balance as user_account_balance,
      utb.balance as user_credit_balance,

      -- Trade statistics
      COALESCE(COUNT(DISTINCT gst.id) FILTER (WHERE gst.status = 'closed'), 0) as total_trades_count,
      COALESCE(COUNT(DISTINCT gst.id) FILTER (WHERE gst.status = 'closed' AND gst.profit_loss > 0), 0) as winning_trades_count,
      COALESCE(COUNT(DISTINCT gst.id) FILTER (WHERE gst.status = 'closed' AND gst.profit_loss <= 0), 0) as losing_trades_count,

      -- Active trades
      COALESCE(COUNT(DISTINCT gst.id) FILTER (WHERE gst.status = 'open'), 0) as active_trades_count,

      -- Active trades detail with real-time PnL (FIX: use rp.mid instead of rp.price)
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'symbol', gst.symbol,
            'pnl', COALESCE(gst.current_pnl, 0),
            'direction', gst.direction,
            'entry_price', gst.entry_price,
            'current_price', COALESCE(rp.mid, gst.current_price, gst.entry_price)
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
    LEFT JOIN user_token_balance utb ON utb.user_id = up.id
    LEFT JOIN goal_session_trades gst ON gst.user_id = up.id
    LEFT JOIN goal_sessions gs ON gs.user_id = up.id
    LEFT JOIN realtime_prices rp ON rp.symbol = gst.symbol
    WHERE
      (search_email IS NULL OR up.email ILIKE '%' || search_email || '%')
    GROUP BY up.id, up.email, up.created_at, up.is_admin, up.account_balance, utb.balance
    ORDER BY last_activity_time DESC
    LIMIT limit_count
  )
  SELECT
    us.user_profile_id,
    us.user_email,
    us.user_created_at,
    us.user_is_admin,
    us.user_account_balance,
    us.user_credit_balance,
    us.total_trades_count,
    us.winning_trades_count,
    us.losing_trades_count,
    us.active_trades_count,
    us.active_trades_detail_json,
    us.scanning_sessions_count,
    us.scanning_duration_mins,
    us.awaiting_response_count,
    us.session_risk_mode,
    us.last_activity_time
  FROM user_stats us;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION admin_get_all_users(text, integer) TO authenticated;
