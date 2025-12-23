/*
  # Fix Ambiguous Column References in admin_get_all_users

  1. Issue
    - Multiple tables have created_at columns causing ambiguity
    - ORDER BY and SELECT need explicit table prefixes

  2. Fix
    - Explicitly qualify ALL column references
    - Fix ORDER BY to use specific table prefix
*/

-- Drop existing function
DROP FUNCTION IF EXISTS admin_get_all_users(text, integer);

-- Recreate with all columns explicitly qualified
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
    up.id,
    au.email::text,
    au.created_at::timestamptz,
    up.is_admin::boolean,
    up.account_balance::numeric,
    COALESCE(utb.balance, 0)::numeric,

    -- Total trades (all closed trades)
    COALESCE(
      (SELECT COUNT(*)
       FROM goal_session_trades gst
       WHERE gst.user_id = up.id
       AND gst.status IN ('closed', 'stopped', 'manual_close')),
      0
    )::bigint,

    -- Winning trades (closed with profit)
    COALESCE(
      (SELECT COUNT(*)
       FROM goal_session_trades gst
       WHERE gst.user_id = up.id
       AND gst.status IN ('closed', 'stopped', 'manual_close')
       AND gst.profit_loss > 0),
      0
    )::bigint,

    -- Losing trades (closed with loss or zero)
    COALESCE(
      (SELECT COUNT(*)
       FROM goal_session_trades gst
       WHERE gst.user_id = up.id
       AND gst.status IN ('closed', 'stopped', 'manual_close')
       AND COALESCE(gst.profit_loss, 0) <= 0),
      0
    )::bigint,

    -- Active trades count
    COALESCE(
      (SELECT COUNT(*)
       FROM goal_session_trades gst
       WHERE gst.user_id = up.id
       AND gst.status IN ('open', 'pending', 'soft_closing')),
      0
    )::bigint,

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
    )::jsonb,

    -- Scanning sessions
    COALESCE(
      (SELECT COUNT(*)
       FROM goal_sessions gs
       WHERE gs.user_id = up.id
       AND gs.status = 'scanning'),
      0
    )::bigint,

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
    )::numeric,

    -- Awaiting response sessions
    COALESCE(
      (SELECT COUNT(*)
       FROM goal_sessions gs
       WHERE gs.user_id = up.id
       AND gs.status = 'awaiting_response'),
      0
    )::bigint,

    -- Last activity
    GREATEST(
      up.updated_at,
      COALESCE((SELECT MAX(gs.created_at) FROM goal_sessions gs WHERE gs.user_id = up.id), up.updated_at),
      COALESCE((SELECT MAX(gst.created_at) FROM goal_session_trades gst WHERE gst.user_id = up.id), up.updated_at)
    )::timestamptz

  FROM user_profiles up
  INNER JOIN auth.users au ON au.id = up.id
  LEFT JOIN user_token_balance utb ON utb.user_id = up.id
  WHERE
    (search_email IS NULL OR au.email ILIKE '%' || search_email || '%')
  ORDER BY au.created_at DESC
  LIMIT limit_count;
END;
$$;

-- Grant execute permission to authenticated users (RLS handles admin check)
GRANT EXECUTE ON FUNCTION admin_get_all_users TO authenticated;
