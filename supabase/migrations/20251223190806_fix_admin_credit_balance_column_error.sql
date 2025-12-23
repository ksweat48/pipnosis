/*
  # Fix credit_balance Column Error in admin_get_all_users

  1. Issue
    - Function was referencing up.credit_balance which doesn't exist
    - credit_balance comes from user_token_balance.balance, not user_profiles

  2. Fix
    - Use COALESCE(utb.balance, 0) as credit_balance
    - Ensure LEFT JOIN to user_token_balance is present
*/

-- Drop existing function
DROP FUNCTION IF EXISTS admin_get_all_users(text, integer);

-- Recreate with correct credit_balance reference
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
  last_activity timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  calling_user_id uuid;
  is_calling_user_admin boolean;
BEGIN
  -- Get the calling user's ID
  calling_user_id := auth.uid();

  -- Check if calling user is admin
  SELECT up.is_admin INTO is_calling_user_admin
  FROM user_profiles up
  WHERE up.id = calling_user_id;

  -- Enforce admin-only access
  IF NOT COALESCE(is_calling_user_admin, false) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- Return user data with real-time unrealized PnL
  RETURN QUERY
  SELECT
    up.id AS user_id,
    au.email,
    au.created_at,
    up.is_admin,
    up.account_balance,
    COALESCE(utb.balance, 0) AS credit_balance,

    -- Total trades (all closed trades)
    COALESCE(
      (SELECT COUNT(*)
       FROM goal_session_trades gst
       WHERE gst.user_id = up.id
       AND gst.status IN ('closed', 'stopped', 'manual_close')),
      0
    ) AS total_trades,

    -- Winning trades (closed with profit)
    COALESCE(
      (SELECT COUNT(*)
       FROM goal_session_trades gst
       WHERE gst.user_id = up.id
       AND gst.status IN ('closed', 'stopped', 'manual_close')
       AND gst.profit_loss > 0),
      0
    ) AS winning_trades,

    -- Losing trades (closed with loss or zero)
    COALESCE(
      (SELECT COUNT(*)
       FROM goal_session_trades gst
       WHERE gst.user_id = up.id
       AND gst.status IN ('closed', 'stopped', 'manual_close')
       AND COALESCE(gst.profit_loss, 0) <= 0),
      0
    ) AS losing_trades,

    -- Active trades count
    COALESCE(
      (SELECT COUNT(*)
       FROM goal_session_trades gst
       WHERE gst.user_id = up.id
       AND gst.status IN ('open', 'pending', 'soft_closing')),
      0
    ) AS active_trades,

    -- Active trades detail with REAL-TIME UNREALIZED PNL
    COALESCE(
      (SELECT jsonb_agg(
         jsonb_build_object(
           'symbol', trade_data.symbol,
           'direction', trade_data.direction,
           'entry_price', trade_data.entry_price,
           'current_price', trade_data.current_price,
           'pnl', trade_data.unrealized_pnl
         )
       )
       FROM (
         SELECT
           gst.symbol,
           gst.direction,
           gst.entry_price,
           COALESCE(
             CASE
               WHEN gst.direction = 'buy' THEN rp.bid
               ELSE rp.ask
             END,
             gst.entry_price
           ) AS current_price,
           -- Calculate LIVE unrealized PnL using current market price
           COALESCE(
             calculate_pnl_universal(
               gst.symbol,
               gst.direction,
               gst.entry_price,
               CASE
                 WHEN gst.direction = 'buy' THEN COALESCE(rp.bid, gst.entry_price)
                 ELSE COALESCE(rp.ask, gst.entry_price)
               END,
               COALESCE(gst.position_size, 0.01)
             ),
             0
           ) AS unrealized_pnl
         FROM goal_session_trades gst
         LEFT JOIN realtime_prices rp ON rp.symbol = gst.symbol
         WHERE gst.user_id = up.id
         AND gst.status IN ('open', 'pending', 'soft_closing')
         ORDER BY gst.created_at DESC
         LIMIT 5
       ) AS trade_data),
      '[]'::jsonb
    ) AS active_trades_detail,

    -- Scanning sessions
    COALESCE(
      (SELECT COUNT(*)
       FROM goal_sessions gs
       WHERE gs.user_id = up.id
       AND gs.status = 'scanning'),
      0
    ) AS scanning_sessions,

    -- Scanning duration (in minutes, capped at 15 minutes max)
    COALESCE(
      (SELECT LEAST(
         EXTRACT(EPOCH FROM (NOW() - MIN(gs.created_at))) / 60,
         15
       )
       FROM goal_sessions gs
       WHERE gs.user_id = up.id
       AND gs.status = 'scanning'),
      NULL
    ) AS scanning_duration_minutes,

    -- Awaiting response sessions
    COALESCE(
      (SELECT COUNT(*)
       FROM goal_sessions gs
       WHERE gs.user_id = up.id
       AND gs.status = 'awaiting_response'),
      0
    ) AS awaiting_response_sessions,

    -- Last activity
    GREATEST(
      up.updated_at,
      COALESCE((SELECT MAX(created_at) FROM goal_sessions WHERE user_id = up.id), up.updated_at),
      COALESCE((SELECT MAX(created_at) FROM goal_session_trades WHERE user_id = up.id), up.updated_at)
    ) AS last_activity

  FROM user_profiles up
  INNER JOIN auth.users au ON au.id = up.id
  LEFT JOIN user_token_balance utb ON utb.user_id = up.id
  WHERE
    (search_email IS NULL OR au.email ILIKE '%' || search_email || '%')
  ORDER BY up.created_at DESC
  LIMIT limit_count;
END;
$$;

-- Grant execute permission to authenticated users (RLS handles admin check)
GRANT EXECUTE ON FUNCTION admin_get_all_users TO authenticated;
