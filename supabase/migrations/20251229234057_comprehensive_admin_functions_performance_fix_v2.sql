/*
  # Comprehensive Admin Functions Performance Fix

  ## Problems
  1. admin_get_all_users times out due to inefficient realtime_prices join
  2. Cartesian product from joining realtime_prices without proper constraints
  3. Multiple aggregations causing slow query performance
  4. Missing performance indexes

  ## Solutions
  1. Use LATERAL join with subqueries for realtime_prices (only latest price)
  2. Add proper indexes on frequently queried columns
  3. Simplify aggregations using LATERAL subqueries instead of complex joins
  4. Remove unnecessary data from initial load

  ## Changes
  - Rewrite admin_get_all_users with efficient subqueries
  - Add critical performance indexes
  - Optimize admin_get_user_details
  - Fix all realtime_prices joins
*/

-- ============================================================================
-- STEP 1: Add Required Extensions
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================================
-- STEP 2: Add Performance Indexes
-- ============================================================================

-- Index for user lookups by email (with trigram for ILIKE)
CREATE INDEX IF NOT EXISTS idx_user_profiles_email_search 
  ON user_profiles USING gin (email gin_trgm_ops);

-- Index for trade status filtering
CREATE INDEX IF NOT EXISTS idx_goal_session_trades_user_status 
  ON goal_session_trades(user_id, status);

-- Index for goal sessions user status
CREATE INDEX IF NOT EXISTS idx_goal_sessions_user_status 
  ON goal_sessions(user_id, status);

-- Index for realtime prices latest lookup
CREATE INDEX IF NOT EXISTS idx_realtime_prices_symbol_created 
  ON realtime_prices(symbol, created_at DESC);

-- Index for trade pnl calculations
CREATE INDEX IF NOT EXISTS idx_goal_session_trades_user_pnl 
  ON goal_session_trades(user_id, profit_loss) 
  WHERE status = 'closed';

-- Index for trade created_at (for sorting/filtering)
CREATE INDEX IF NOT EXISTS idx_goal_session_trades_created_at 
  ON goal_session_trades(created_at DESC);

-- Index for session updated_at (for duration calculations)
CREATE INDEX IF NOT EXISTS idx_goal_sessions_updated_at 
  ON goal_sessions(updated_at DESC);

-- ============================================================================
-- STEP 3: Rewrite admin_get_all_users with Efficient Query
-- ============================================================================

DROP FUNCTION IF EXISTS admin_get_all_users(text, integer);

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
  SELECT
    up.id as user_profile_id,
    up.email as user_email,
    up.created_at as user_created_at,
    up.is_admin as user_is_admin,
    up.account_balance as user_account_balance,
    COALESCE(utb.balance, 0) as user_credit_balance,
    
    -- Trade counts using efficient subqueries
    COALESCE(trade_stats.total_trades, 0) as total_trades_count,
    COALESCE(trade_stats.winning_trades, 0) as winning_trades_count,
    COALESCE(trade_stats.losing_trades, 0) as losing_trades_count,
    COALESCE(trade_stats.active_trades, 0) as active_trades_count,
    
    -- Active trades detail (limited to prevent bloat)
    COALESCE(active_trades.trades_json, '[]'::jsonb) as active_trades_detail_json,
    
    -- Session stats
    COALESCE(session_stats.scanning_count, 0) as scanning_sessions_count,
    session_stats.scanning_duration_mins,
    COALESCE(session_stats.awaiting_count, 0) as awaiting_response_count,
    session_stats.risk_mode as session_risk_mode,
    
    -- Last activity
    GREATEST(
      up.created_at,
      COALESCE(trade_stats.last_trade_time, up.created_at),
      COALESCE(session_stats.last_session_time, up.created_at)
    ) as last_activity_time
    
  FROM user_profiles up
  
  -- Token balance
  LEFT JOIN user_token_balance utb ON utb.user_id = up.id
  
  -- Trade statistics (single subquery)
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) FILTER (WHERE status = 'closed') as total_trades,
      COUNT(*) FILTER (WHERE status = 'closed' AND profit_loss > 0) as winning_trades,
      COUNT(*) FILTER (WHERE status = 'closed' AND profit_loss <= 0) as losing_trades,
      COUNT(*) FILTER (WHERE status = 'open') as active_trades,
      MAX(created_at) as last_trade_time
    FROM goal_session_trades
    WHERE user_id = up.id
  ) trade_stats ON true
  
  -- Active trades detail (limited, with latest price from subquery)
  LEFT JOIN LATERAL (
    SELECT
      jsonb_agg(
        jsonb_build_object(
          'symbol', gst.symbol,
          'pnl', COALESCE(gst.current_pnl, 0),
          'direction', gst.direction,
          'entry_price', gst.entry_price,
          'current_price', COALESCE(
            (SELECT mid FROM realtime_prices rp 
             WHERE rp.symbol = gst.symbol 
             ORDER BY rp.created_at DESC 
             LIMIT 1),
            gst.current_price,
            gst.entry_price
          )
        )
        ORDER BY gst.created_at DESC
      ) as trades_json
    FROM goal_session_trades gst
    WHERE gst.user_id = up.id
      AND gst.status = 'open'
    LIMIT 10  -- Limit to prevent bloat
  ) active_trades ON true
  
  -- Session statistics (single subquery)
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) FILTER (WHERE status = 'scanning') as scanning_count,
      COUNT(*) FILTER (WHERE status = 'awaiting_response') as awaiting_count,
      MAX(created_at) as last_session_time,
      EXTRACT(EPOCH FROM (NOW() - MIN(updated_at) FILTER (WHERE status = 'scanning'))) / 60 as scanning_duration_mins,
      (SELECT risk_mode FROM goal_sessions WHERE user_id = up.id AND status = 'scanning' ORDER BY updated_at DESC LIMIT 1) as risk_mode
    FROM goal_sessions
    WHERE user_id = up.id
  ) session_stats ON true
  
  WHERE
    (search_email IS NULL OR up.email ILIKE '%' || search_email || '%')
  
  ORDER BY last_activity_time DESC
  LIMIT limit_count;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION admin_get_all_users(text, integer) TO authenticated;

-- ============================================================================
-- STEP 4: Optimize admin_get_user_details
-- ============================================================================

DROP FUNCTION IF EXISTS admin_get_user_details(uuid);

CREATE OR REPLACE FUNCTION admin_get_user_details(target_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  calling_user_id uuid;
  result jsonb;
BEGIN
  calling_user_id := auth.uid();

  -- Security check
  IF NOT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = calling_user_id AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- Build result using efficient subqueries
  SELECT jsonb_build_object(
    'user_profile', (
      SELECT jsonb_build_object(
        'id', up.id,
        'email', up.email,
        'created_at', up.created_at,
        'is_admin', up.is_admin,
        'account_balance', up.account_balance
      )
      FROM user_profiles up
      WHERE up.id = target_user_id
    ),
    'credit_balance', (
      SELECT COALESCE(balance, 0)
      FROM user_token_balance
      WHERE user_id = target_user_id
    ),
    'trade_stats', (
      SELECT jsonb_build_object(
        'total_trades', COUNT(*) FILTER (WHERE status = 'closed'),
        'winning_trades', COUNT(*) FILTER (WHERE status = 'closed' AND profit_loss > 0),
        'losing_trades', COUNT(*) FILTER (WHERE status = 'closed' AND profit_loss <= 0),
        'active_trades', COUNT(*) FILTER (WHERE status = 'open'),
        'total_pnl', COALESCE(SUM(profit_loss) FILTER (WHERE status = 'closed'), 0),
        'unrealized_pnl', COALESCE(SUM(current_pnl) FILTER (WHERE status = 'open'), 0)
      )
      FROM goal_session_trades
      WHERE user_id = target_user_id
    ),
    'active_trades', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', gst.id,
          'symbol', gst.symbol,
          'direction', gst.direction,
          'entry_price', gst.entry_price,
          'current_price', gst.current_price,
          'current_pnl', gst.current_pnl,
          'stop_loss', gst.stop_loss,
          'take_profit', gst.take_profit,
          'created_at', gst.created_at
        )
      ), '[]'::jsonb)
      FROM goal_session_trades gst
      WHERE gst.user_id = target_user_id
        AND gst.status = 'open'
      ORDER BY gst.created_at DESC
      LIMIT 20
    ),
    'goal_sessions', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', gs.id,
          'status', gs.status,
          'risk_mode', gs.risk_mode,
          'goal_amount', gs.goal,
          'created_at', gs.created_at,
          'updated_at', gs.updated_at
        )
      ), '[]'::jsonb)
      FROM goal_sessions gs
      WHERE gs.user_id = target_user_id
      ORDER BY gs.created_at DESC
      LIMIT 10
    )
  ) INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_user_details(uuid) TO authenticated;

-- ============================================================================
-- STEP 5: Analyze tables for query planner optimization
-- ============================================================================

ANALYZE user_profiles;
ANALYZE goal_session_trades;
ANALYZE goal_sessions;
ANALYZE user_token_balance;
ANALYZE realtime_prices;
