/*
  # Fix Admin Functions - Remove trade_history References

  1. Purpose
    - Update all admin functions to use only goal_session_trades
    - Remove references to the old trade_history table
    - Maintain compatibility with the consolidated goal-based trading system

  2. Changes
    - admin_get_all_users: Use only goal_session_trades
    - admin_recalculate_user_balance: Use only goal_session_trades
    - admin_get_user_details: Use only goal_session_trades
*/

-- Function: Get all users (FIXED - no trade_history)
CREATE OR REPLACE FUNCTION admin_get_all_users(
  search_email text DEFAULT NULL,
  limit_count int DEFAULT 100
)
RETURNS TABLE (
  user_id uuid,
  email text,
  created_at timestamptz,
  is_admin boolean,
  account_balance decimal,
  credit_balance decimal,
  total_trades bigint,
  active_trades bigint,
  last_activity timestamptz
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  calling_user_is_admin boolean;
BEGIN
  SELECT up.is_admin INTO calling_user_is_admin
  FROM user_profiles up
  WHERE up.id = auth.uid();

  IF NOT COALESCE(calling_user_is_admin, false) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    up.id as user_id,
    au.email::text,
    up.created_at,
    up.is_admin,
    up.account_balance,
    COALESCE(utb.balance, 0) as credit_balance,
    COALESCE(
      (SELECT COUNT(*) FROM goal_session_trades gst WHERE gst.user_id = up.id),
      0
    )::bigint as total_trades,
    COALESCE(
      (SELECT COUNT(*) FROM simulated_positions sp WHERE sp.user_id = up.id AND sp.status = 'open'),
      0
    )::bigint as active_trades,
    GREATEST(
      up.created_at,
      COALESCE((SELECT MAX(closed_at) FROM goal_session_trades gst WHERE gst.user_id = up.id), up.created_at),
      COALESCE((SELECT MAX(updated_at) FROM simulated_positions sp WHERE sp.user_id = up.id), up.created_at)
    ) as last_activity
  FROM user_profiles up
  INNER JOIN auth.users au ON au.id = up.id
  LEFT JOIN user_token_balance utb ON utb.user_id = up.id
  WHERE
    (search_email IS NULL OR au.email ILIKE '%' || search_email || '%')
  ORDER BY up.created_at DESC
  LIMIT limit_count;
END;
$$;

-- Function: Recalculate user balance (FIXED - no trade_history)
CREATE OR REPLACE FUNCTION admin_recalculate_user_balance(
  target_user_id uuid
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  calling_user_is_admin boolean;
  old_balance decimal;
  goal_trades_pnl decimal;
  starting_balance decimal := 10000;
  correct_balance decimal;
  balance_diff decimal;
  result jsonb;
BEGIN
  SELECT up.is_admin INTO calling_user_is_admin
  FROM user_profiles up
  WHERE up.id = auth.uid();

  IF NOT COALESCE(calling_user_is_admin, false) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT account_balance INTO old_balance
  FROM user_profiles
  WHERE id = target_user_id;

  -- Only use goal_session_trades
  SELECT COALESCE(SUM(profit_loss), 0) INTO goal_trades_pnl
  FROM goal_session_trades
  WHERE user_id = target_user_id AND status = 'closed';

  correct_balance := starting_balance + goal_trades_pnl;
  balance_diff := correct_balance - old_balance;

  UPDATE user_profiles
  SET
    account_balance = correct_balance,
    updated_at = now()
  WHERE id = target_user_id;

  IF ABS(balance_diff) > 0.01 THEN
    INSERT INTO balance_transactions (
      user_id,
      transaction_type,
      amount,
      balance_before,
      balance_after,
      description,
      metadata
    ) VALUES (
      target_user_id,
      'admin_correction',
      balance_diff,
      old_balance,
      correct_balance,
      'Admin balance recalculation',
      jsonb_build_object(
        'admin_user_id', auth.uid(),
        'goal_trades_pnl', goal_trades_pnl
      )
    );
  END IF;

  result := jsonb_build_object(
    'success', true,
    'old_balance', old_balance,
    'correct_balance', correct_balance,
    'balance_diff', balance_diff,
    'goal_trades_pnl', goal_trades_pnl,
    'total_goal_trades', (SELECT COUNT(*) FROM goal_session_trades WHERE user_id = target_user_id)
  );

  RETURN result;
END;
$$;

-- Function: Get detailed user information (FIXED - no trade_history)
CREATE OR REPLACE FUNCTION admin_get_user_details(
  target_user_id uuid
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  calling_user_is_admin boolean;
  user_email text;
  user_data jsonb;
  balance_data jsonb;
  trade_stats jsonb;
  active_data jsonb;
  recent_trades jsonb;
  goal_sessions jsonb;
BEGIN
  SELECT up.is_admin INTO calling_user_is_admin
  FROM user_profiles up
  WHERE up.id = auth.uid();

  IF NOT COALESCE(calling_user_is_admin, false) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT au.email INTO user_email
  FROM auth.users au
  WHERE au.id = target_user_id;

  SELECT jsonb_build_object(
    'user_id', up.id,
    'email', user_email,
    'created_at', up.created_at,
    'is_admin', up.is_admin
  ) INTO user_data
  FROM user_profiles up
  WHERE up.id = target_user_id;

  SELECT jsonb_build_object(
    'account_balance', up.account_balance,
    'demo_balance', up.demo_balance,
    'credit_balance', COALESCE(utb.balance, 0),
    'lifetime_credits_earned', COALESCE(utb.lifetime_earned, 0)
  ) INTO balance_data
  FROM user_profiles up
  LEFT JOIN user_token_balance utb ON utb.user_id = up.id
  WHERE up.id = target_user_id;

  -- Only use goal_session_trades
  SELECT jsonb_build_object(
    'total_trades', COUNT(*),
    'winning_trades', COUNT(*) FILTER (WHERE profit_loss > 0),
    'losing_trades', COUNT(*) FILTER (WHERE profit_loss < 0),
    'win_rate', CASE
      WHEN COUNT(*) > 0 THEN ROUND((COUNT(*) FILTER (WHERE profit_loss > 0)::decimal / COUNT(*)) * 100, 2)
      ELSE 0
    END,
    'net_pnl', COALESCE(SUM(profit_loss), 0),
    'avg_win', COALESCE(AVG(profit_loss) FILTER (WHERE profit_loss > 0), 0),
    'avg_loss', COALESCE(AVG(profit_loss) FILTER (WHERE profit_loss < 0), 0)
  ) INTO trade_stats
  FROM goal_session_trades
  WHERE user_id = target_user_id AND status = 'closed';

  SELECT jsonb_build_object(
    'active_trades_count', COUNT(*),
    'active_trades', COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', sp.id,
        'symbol', sp.symbol,
        'direction', sp.direction,
        'entry_price', sp.entry_price,
        'current_price', sp.current_price,
        'unrealized_pnl', sp.unrealized_pnl,
        'opened_at', sp.opened_at
      )
    ), '[]'::jsonb)
  ) INTO active_data
  FROM simulated_positions sp
  WHERE sp.user_id = target_user_id AND sp.status = 'open';

  -- Only use goal_session_trades
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', gst.id,
      'symbol', gst.symbol,
      'direction', gst.direction,
      'pnl', gst.profit_loss,
      'closed_at', gst.closed_at,
      'source', 'goal_session'
    ) ORDER BY gst.closed_at DESC
  ), '[]'::jsonb) INTO recent_trades
  FROM goal_session_trades gst
  WHERE gst.user_id = target_user_id AND gst.status = 'closed'
  LIMIT 5;

  SELECT jsonb_build_object(
    'active_sessions', COUNT(*) FILTER (WHERE status IN ('scanning', 'trading', 'awaiting_user_action')),
    'completed_sessions', COUNT(*) FILTER (WHERE status IN ('achieved', 'failed')),
    'stuck_sessions', COUNT(*) FILTER (WHERE status = 'awaiting_user_action'),
    'sessions', COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', gs.id,
        'target_value', gs.target_value,
        'current_progress', gs.current_progress,
        'status', gs.status,
        'created_at', gs.created_at
      ) ORDER BY gs.created_at DESC
    ) FILTER (WHERE status IN ('scanning', 'trading', 'awaiting_user_action')), '[]'::jsonb)
  ) INTO goal_sessions
  FROM goal_sessions gs
  WHERE gs.user_id = target_user_id;

  RETURN jsonb_build_object(
    'user', user_data,
    'balances', balance_data,
    'trade_stats', trade_stats,
    'active', active_data,
    'recent_trades', recent_trades,
    'goal_sessions', goal_sessions
  );
END;
$$;

COMMENT ON FUNCTION admin_get_all_users IS 'Get all users with stats (using only goal_session_trades)';
COMMENT ON FUNCTION admin_recalculate_user_balance IS 'Recalculate user balance from goal_session_trades only';
COMMENT ON FUNCTION admin_get_user_details IS 'Get detailed user information (using only goal_session_trades)';
