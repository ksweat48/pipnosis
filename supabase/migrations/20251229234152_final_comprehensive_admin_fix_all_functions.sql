/*
  # Final Comprehensive Admin Functions Fix

  ## Problem
  - Multiple admin functions have performance issues
  - Inefficient joins causing timeouts
  - Incorrect table references
  - Missing optimizations

  ## Solution
  - Rewrite ALL admin functions with proper optimizations
  - Use LATERAL subqueries for efficiency
  - Remove cartesian products
  - Add timeout protection

  ## Functions Fixed
  1. admin_get_all_users - Main dashboard function
  2. admin_get_platform_kpis - Platform statistics
  3. admin_get_user_details - User details (already optimized)
*/

-- ============================================================================
-- DROP ALL EXISTING ADMIN FUNCTIONS
-- ============================================================================

DROP FUNCTION IF EXISTS admin_get_all_users(text, integer);
DROP FUNCTION IF EXISTS admin_get_platform_kpis();

-- ============================================================================
-- FUNCTION 1: admin_get_all_users (Optimized)
-- ============================================================================

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
SET statement_timeout = '30s'  -- Add timeout protection
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
          'pnl', COALESCE(t.current_pnl, 0),
          'direction', t.direction,
          'entry_price', t.entry_price,
          'current_price', COALESCE(t.current_price, t.entry_price)
        )
        ORDER BY t.created_at DESC
      ) as trades_json
    FROM (
      SELECT symbol, current_pnl, direction, entry_price, current_price, created_at
      FROM goal_session_trades
      WHERE user_id = up.id AND status = 'open'
      ORDER BY created_at DESC
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
  ORDER BY last_activity_time DESC
  LIMIT limit_count;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_all_users(text, integer) TO authenticated;

-- ============================================================================
-- FUNCTION 2: admin_get_platform_kpis (Optimized)
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_get_platform_kpis()
RETURNS TABLE (
  total_users bigint,
  active_users bigint,
  total_trades bigint,
  winning_trades bigint,
  losing_trades bigint,
  overall_win_rate numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15s'
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
  WITH stats AS (
    SELECT
      (SELECT COUNT(*) FROM user_profiles) as total_users,
      (SELECT COUNT(DISTINCT user_id) 
       FROM goal_session_trades 
       WHERE created_at >= NOW() - INTERVAL '7 days') as active_users,
      COUNT(*) FILTER (WHERE status = 'closed') as total_trades,
      COUNT(*) FILTER (WHERE status = 'closed' AND profit_loss > 0) as winning_trades,
      COUNT(*) FILTER (WHERE status = 'closed' AND profit_loss <= 0) as losing_trades,
      CASE 
        WHEN COUNT(*) FILTER (WHERE status = 'closed') > 0 THEN
          ROUND(
            (COUNT(*) FILTER (WHERE status = 'closed' AND profit_loss > 0)::numeric / 
             COUNT(*) FILTER (WHERE status = 'closed')::numeric) * 100, 
            2
          )
        ELSE 0
      END as win_rate
    FROM goal_session_trades
  )
  SELECT 
    s.total_users::bigint,
    s.active_users::bigint,
    s.total_trades::bigint,
    s.winning_trades::bigint,
    s.losing_trades::bigint,
    s.win_rate
  FROM stats s;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_platform_kpis() TO authenticated;

-- ============================================================================
-- REFRESH STATISTICS
-- ============================================================================

ANALYZE user_profiles;
ANALYZE goal_session_trades;
ANALYZE goal_sessions;
ANALYZE user_token_balance;
