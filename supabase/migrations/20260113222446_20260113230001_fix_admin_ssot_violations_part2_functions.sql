/*
  # Fix Admin Dashboard SSOT Violations - Part 2: Functions and Permissions

  ## Critical Fixes:
  1. Admin P&L calculation using lot_size with symbol-specific defaults
  2. Force close permissions for authenticated admin users
  3. SSOT enforcement trigger
*/

-- ============================================================================
-- Fix admin_get_all_users_paginated
-- ============================================================================

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
    COALESCE(ts.total_trades, 0),
    COALESCE(ts.winning_trades, 0),
    COALESCE(ts.losing_trades, 0),
    COALESCE(ts.active_trades, 0),
    COALESCE(at.trades_json, '[]'::jsonb),
    COALESCE(ss.scanning_count, 0),
    ss.scanning_duration_mins,
    COALESCE(ss.awaiting_count, 0),
    ss.risk_mode,
    GREATEST(
      up.created_at,
      COALESCE(ts.last_trade_time, up.created_at),
      COALESCE(ss.last_session_time, up.created_at)
    )
  FROM user_profiles up
  LEFT JOIN user_token_balance utb ON utb.user_id = up.id
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
        gst.lot_size,
        gst.created_at as trade_created_at,
        CASE WHEN gst.direction = 'buy' THEN lp.bid ELSE lp.ask END as live_price,
        calculate_pnl_universal(
          gst.symbol,
          gst.direction,
          gst.entry_price,
          CASE WHEN gst.direction = 'buy' THEN COALESCE(lp.bid, gst.entry_price) ELSE COALESCE(lp.ask, gst.entry_price) END,
          CASE
            WHEN UPPER(gst.symbol) IN ('US30', 'NAS100', 'SPX500', 'GER40', 'UK100', 'DJI30') THEN COALESCE(gst.lot_size, 1.0)
            WHEN UPPER(gst.symbol) LIKE 'BTC%' OR UPPER(gst.symbol) LIKE 'ETH%' THEN COALESCE(gst.lot_size, 0.001)
            ELSE COALESCE(gst.lot_size, 0.01)
          END
        ) as live_pnl
      FROM goal_session_trades gst
      LEFT JOIN LATERAL (
        SELECT rp.bid, rp.ask
        FROM realtime_prices rp
        WHERE rp.symbol = gst.symbol
        ORDER BY rp.created_at DESC
        LIMIT 1
      ) lp ON true
      WHERE gst.user_id = up.id AND gst.status = 'open'
      ORDER BY gst.created_at DESC
      LIMIT 10
    ) t
  ) at ON true
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
  ORDER BY
    CASE WHEN COALESCE(ts.active_trades, 0) > 0 THEN 0 ELSE 1 END,
    CASE WHEN COALESCE(ss.scanning_count, 0) > 0 THEN 0 ELSE 1 END,
    GREATEST(
      up.created_at,
      COALESCE(ts.last_trade_time, up.created_at),
      COALESCE(ss.last_session_time, up.created_at)
    ) DESC
  LIMIT page_size OFFSET page_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_all_users_paginated(text, integer, integer) TO authenticated;

-- ============================================================================
-- Fix non-paginated version
-- ============================================================================

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
SET statement_timeout = '30s'
AS $$
BEGIN
  RETURN QUERY SELECT * FROM admin_get_all_users_paginated(search_email, limit_count, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_all_users(text, integer) TO authenticated;

-- ============================================================================
-- Fix force_close permissions
-- ============================================================================

DROP FUNCTION IF EXISTS force_close_stale_scanning_sessions();

CREATE OR REPLACE FUNCTION force_close_stale_scanning_sessions()
RETURNS TABLE (session_id uuid, user_id uuid, minutes_scanning numeric)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  calling_user_id uuid;
BEGIN
  calling_user_id := auth.uid();

  IF NOT EXISTS (
    SELECT 1 FROM user_profiles WHERE id = calling_user_id AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  WITH stale_sessions AS (
    UPDATE goal_sessions
    SET status = 'user_stopped', completed_at = NOW(),
        awaiting_continuation_confirmation = false,
        continuation_confirmation_expires_at = NULL,
        updated_at = NOW()
    WHERE status IN ('scanning', 'trade_pending')
      AND scanning_started_at IS NOT NULL
      AND EXTRACT(EPOCH FROM (NOW() - scanning_started_at)) / 60 > 30
    RETURNING id, user_id, EXTRACT(EPOCH FROM (NOW() - scanning_started_at)) / 60 as minutes
  )
  SELECT * FROM stale_sessions;
END;
$$;

GRANT EXECUTE ON FUNCTION force_close_stale_scanning_sessions TO authenticated;
GRANT EXECUTE ON FUNCTION force_close_stale_scanning_sessions TO service_role;

-- ============================================================================
-- SSOT enforcement trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_position_size_from_lot_size()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lot_size IS NOT NULL THEN
    NEW.position_size := NEW.lot_size;
  ELSIF NEW.position_size IS NOT NULL AND NEW.lot_size IS NULL THEN
    NEW.lot_size := NEW.position_size;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_sync_position_size ON goal_session_trades;

CREATE TRIGGER trigger_sync_position_size
  BEFORE INSERT OR UPDATE ON goal_session_trades
  FOR EACH ROW EXECUTE FUNCTION sync_position_size_from_lot_size();

DO $$
BEGIN
  RAISE NOTICE '✓ Admin SSOT violations fixed';
  RAISE NOTICE '  - P&L calculation uses lot_size with symbol-specific defaults';
  RAISE NOTICE '  - Force close permissions granted to authenticated admins';
  RAISE NOTICE '  - SSOT enforcement trigger active';
END $$;
