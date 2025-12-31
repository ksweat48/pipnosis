/*
  # Fix Admin Dashboard - Live P&L Calculation
  
  ## Problem
  The admin dashboard shows STALE P&L values for open trades because:
  - Previous migrations used `gst.current_pnl` column which is only updated when trades CLOSE
  - Open trades never have their `current_pnl` updated with live market prices
  - Result: Admin sees frozen P&L values that don't reflect current market conditions
  
  ## Solution
  - Join with `realtime_prices` table to get the LATEST price for each symbol
  - Use `calculate_pnl_universal()` to calculate P&L dynamically with live prices
  - Use `DISTINCT ON` to get only the most recent price per symbol
  
  ## Changes
  - Recreate `admin_get_all_users` function with live P&L calculation
  - Uses subquery with DISTINCT ON to get latest price per symbol
  - Calculates unrealized P&L in real-time using current market bid/ask
  
  ## Impact
  - Admin dashboard will show LIVE P&L values that update with market prices
  - Refreshing the admin page will show current unrealized P&L
  - No more frozen/stale P&L values
*/

-- Drop existing function
DROP FUNCTION IF EXISTS admin_get_all_users(text, integer);

-- Recreate with LIVE P&L calculation
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
  calling_user_id uuid;
BEGIN
  -- Security check
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
  ORDER BY last_activity DESC
  LIMIT limit_count;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION admin_get_all_users(text, integer) TO authenticated;

-- Add a comment explaining the live P&L calculation
COMMENT ON FUNCTION admin_get_all_users IS 
  'Returns all users with their stats for admin dashboard. 
   IMPORTANT: Active trades P&L is calculated LIVE using current prices from realtime_prices table,
   not from the stale current_pnl column. This ensures admins see accurate unrealized P&L.';
