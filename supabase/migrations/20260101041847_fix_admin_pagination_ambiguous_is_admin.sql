/*
  # Fix Admin Pagination Ambiguous Column Reference

  ## Problem
  The admin_get_all_users_paginated function has an ambiguous column reference:
  - Line 68: "WHERE id = calling_user_id AND is_admin = true"
  - Error: "column reference 'is_admin' is ambiguous"
  - The is_admin column needs explicit table qualification

  ## Solution
  Explicitly qualify the is_admin column with the table name in the security check.

  ## Changes
  1. Replace function with explicit table qualification: user_profiles.is_admin
  2. Maintain all existing logic and performance characteristics
*/

-- Fix the function with explicit table qualification
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
SET statement_timeout = '30s'
AS $$
DECLARE
  calling_user_id uuid;
BEGIN
  -- Security check: Only admins can view user list
  calling_user_id := auth.uid();

  IF NOT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.id = calling_user_id 
      AND user_profiles.is_admin = true
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

    -- Active trades count
    COALESCE(ts.active_trades, 0),

    -- Active trades detail with LIVE P&L calculation
    COALESCE(at.trades_json, '[]'::jsonb),

    -- Scanning sessions
    COALESCE(ss.scanning_count, 0),
    ss.scanning_duration_mins,
    COALESCE(ss.awaiting_count, 0),
    ss.risk_mode,

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
        -- Get the live price (bid for sells, ask for buys - but bid is exit price for buys)
        CASE
          WHEN gst.direction = 'buy' THEN lp.bid
          ELSE lp.ask
        END as live_price,
        -- Calculate LIVE P&L using current market price
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
      -- Join with latest price for each symbol
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

  -- Session statistics
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) FILTER (WHERE status = 'scanning') as scanning_count,
      COUNT(*) FILTER (WHERE status = 'awaiting_response') as awaiting_count,
      MAX(created_at) as last_session_time,
      EXTRACT(EPOCH FROM (NOW() - MIN(updated_at) FILTER (WHERE status = 'scanning'))) / 60 as scanning_duration_mins,
      (
        SELECT risk_mode
        FROM goal_sessions
        WHERE user_id = up.id AND status = 'scanning'
        ORDER BY updated_at DESC
        LIMIT 1
      ) as risk_mode
    FROM goal_sessions
    WHERE user_id = up.id
  ) ss ON true

  WHERE (search_email IS NULL OR up.email ILIKE '%' || search_email || '%')

  -- THREE-TIER PRIORITY SORTING (same as non-paginated version)
  ORDER BY
    -- Tier 1: Users with OPEN trades (actively trading RIGHT NOW)
    CASE WHEN COALESCE(ts.active_trades, 0) > 0 THEN 0 ELSE 1 END,

    -- Tier 2: Users actively SCANNING for trades (looking for opportunities)
    CASE WHEN COALESCE(ss.scanning_count, 0) > 0 THEN 0 ELSE 1 END,

    -- Tier 3: Within each tier, sort by most recent activity
    GREATEST(
      up.created_at,
      COALESCE(ts.last_trade_time, up.created_at),
      COALESCE(ss.last_session_time, up.created_at)
    ) DESC

  -- PAGINATION: Use LIMIT and OFFSET
  LIMIT page_size
  OFFSET page_offset;
END;
$$;