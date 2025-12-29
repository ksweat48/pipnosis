/*
  # Fix Ambiguous Column References in admin_get_all_users

  ## Problem
  - Column "is_admin" is ambiguous - could be table column or PL/pgSQL variable
  - Need to fully qualify all column references with table aliases

  ## Solution
  - Prefix all column references with their table aliases (up.is_admin, etc.)
*/

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
DECLARE
  calling_user_id uuid;
  is_admin_user boolean;
BEGIN
  calling_user_id := auth.uid();

  SELECT up_check.is_admin INTO is_admin_user
  FROM user_profiles up_check
  WHERE up_check.id = calling_user_id;

  IF NOT COALESCE(is_admin_user, false) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    up.id::uuid,
    up.email::text,
    up.created_at::timestamptz,
    up.is_admin::boolean,
    up.account_balance::numeric,
    COALESCE(utb.balance, 0)::numeric,
    
    COALESCE(ts.total_trades, 0)::bigint,
    COALESCE(ts.winning_trades, 0)::bigint,
    COALESCE(ts.losing_trades, 0)::bigint,
    COALESCE(ts.active_trades, 0)::bigint,
    COALESCE(at.trades_json, '[]'::jsonb)::jsonb,
    
    COALESCE(ss.scanning_count, 0)::bigint,
    ss.scanning_duration_mins::numeric,
    COALESCE(ss.awaiting_count, 0)::bigint,
    ss.risk_mode::text,
    
    GREATEST(
      up.created_at,
      COALESCE(ts.last_trade_time, up.created_at),
      COALESCE(ss.last_session_time, up.created_at)
    )::timestamptz
    
  FROM user_profiles up
  LEFT JOIN user_token_balance utb ON utb.user_id = up.id
  
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
      SELECT gst2.symbol, gst2.current_pnl, gst2.direction, gst2.entry_price, gst2.current_price, gst2.created_at
      FROM goal_session_trades gst2
      WHERE gst2.user_id = up.id AND gst2.status = 'open'
      ORDER BY gst2.created_at DESC
      LIMIT 10
    ) t
  ) at ON true
  
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
  ORDER BY 16 DESC  -- Order by last_activity (column 16)
  LIMIT limit_count;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_all_users(text, integer) TO authenticated;
