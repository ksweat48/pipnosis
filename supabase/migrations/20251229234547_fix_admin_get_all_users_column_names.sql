/*
  # Fix admin_get_all_users Column Names

  ## Problem
  - Function returns column names that don't match frontend interface
  - Frontend expects: user_id, active_trades_detail, prompt_risk
  - Function returns: user_profile_id, active_trades_detail_json, session_risk_mode

  ## Solution
  - Rename columns to match exactly what frontend expects
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
  ORDER BY last_activity DESC
  LIMIT limit_count;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_all_users(text, integer) TO authenticated;
