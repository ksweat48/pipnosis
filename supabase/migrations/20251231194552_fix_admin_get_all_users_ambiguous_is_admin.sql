/*
  # Fix Ambiguous Column Reference in admin_get_all_users
  
  ## Problem
  - Column reference "is_admin" is ambiguous between PL/pgSQL variable and table column
  
  ## Solution
  - Fully qualify all column references with table aliases
*/

-- Drop existing function
DROP FUNCTION IF EXISTS admin_get_all_users(text, integer);

-- Recreate with fully qualified column names
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
DECLARE
  v_calling_user_id uuid;
  v_is_admin boolean;
BEGIN
  -- Security check with explicit variable names
  v_calling_user_id := auth.uid();
  
  SELECT up.is_admin INTO v_is_admin
  FROM user_profiles up
  WHERE up.id = v_calling_user_id;
  
  IF NOT COALESCE(v_is_admin, false) THEN
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
      COUNT(*) FILTER (WHERE gst.status = 'closed') as total_trades,
      COUNT(*) FILTER (WHERE gst.status = 'closed' AND gst.profit_loss > 0) as winning_trades,
      COUNT(*) FILTER (WHERE gst.status = 'closed' AND gst.profit_loss <= 0) as losing_trades,
      COUNT(*) FILTER (WHERE gst.status = 'open') as active_trades,
      MAX(gst.created_at) as last_trade_time
    FROM goal_session_trades gst
    WHERE gst.user_id = up.id
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
        -- Get the live price (bid for buys exit, ask for sells exit)
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
      ) as risk_mode
    FROM goal_sessions gs
    WHERE gs.user_id = up.id
  ) ss ON true
  
  WHERE (search_email IS NULL OR up.email ILIKE '%' || search_email || '%')
  ORDER BY last_activity DESC
  LIMIT limit_count;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION admin_get_all_users(text, integer) TO authenticated;
