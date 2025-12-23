/*
  # Fix admin_get_user_details - goal_amount Column Reference

  1. Problem
    - Function references goal_amount->>'target_value' 
    - The column is actually just 'target_value' (numeric type)
    
  2. Solution
    - Change reference from (goal_amount->>'target_value')::numeric to just target_value
    
  3. Security
    - Maintains existing admin-only access
*/

CREATE OR REPLACE FUNCTION admin_get_user_details(
  target_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  calling_user_id uuid;
  is_calling_user_admin boolean;
  result jsonb;
  v_user_record record;
  v_balance_record record;
  v_trade_stats record;
  v_active_trades jsonb;
  v_recent_trades jsonb;
  v_goal_sessions jsonb;
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

  -- Validate target user exists
  IF NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = target_user_id) THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- Get user basic info
  SELECT
    up.id AS user_id,
    au.email,
    au.created_at,
    up.is_admin
  INTO v_user_record
  FROM user_profiles up
  INNER JOIN auth.users au ON au.id = up.id
  WHERE up.id = target_user_id;

  -- Get balances
  SELECT
    up.account_balance,
    COALESCE(utb.balance, 0) AS credit_balance,
    COALESCE(utb.total_earned, 0) AS lifetime_credits_earned
  INTO v_balance_record
  FROM user_profiles up
  LEFT JOIN user_token_balance utb ON utb.user_id = up.id
  WHERE up.id = target_user_id;

  -- Get trade statistics
  SELECT
    COUNT(*) FILTER (WHERE status IN ('closed', 'stopped', 'manual_close')) AS total_trades,
    COUNT(*) FILTER (WHERE status IN ('closed', 'stopped', 'manual_close') AND profit_loss > 0) AS winning_trades,
    COUNT(*) FILTER (WHERE status IN ('closed', 'stopped', 'manual_close') AND COALESCE(profit_loss, 0) <= 0) AS losing_trades,
    COALESCE(SUM(profit_loss) FILTER (WHERE status IN ('closed', 'stopped', 'manual_close')), 0) AS net_pnl,
    COALESCE(AVG(profit_loss) FILTER (WHERE status IN ('closed', 'stopped', 'manual_close') AND profit_loss > 0), 0) AS avg_win,
    COALESCE(AVG(profit_loss) FILTER (WHERE status IN ('closed', 'stopped', 'manual_close') AND profit_loss < 0), 0) AS avg_loss
  INTO v_trade_stats
  FROM goal_session_trades
  WHERE user_id = target_user_id;

  -- Calculate win rate
  v_trade_stats.total_trades := COALESCE(v_trade_stats.total_trades, 0);
  v_trade_stats.winning_trades := COALESCE(v_trade_stats.winning_trades, 0);

  -- Get active trades
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'symbol', symbol,
      'direction', direction,
      'entry_price', entry_price,
      'current_price', current_price,
      'unrealized_pnl', COALESCE(profit_loss, 0),
      'opened_at', created_at
    )
    ORDER BY created_at DESC
  ), '[]'::jsonb)
  INTO v_active_trades
  FROM goal_session_trades
  WHERE user_id = target_user_id
  AND status IN ('open', 'pending', 'soft_closing')
  LIMIT 10;

  -- Get recent closed trades
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'symbol', symbol,
      'direction', direction,
      'pnl', COALESCE(profit_loss, 0),
      'closed_at', closed_at,
      'source', 'goal_session'
    )
    ORDER BY closed_at DESC
  ), '[]'::jsonb)
  INTO v_recent_trades
  FROM goal_session_trades
  WHERE user_id = target_user_id
  AND status IN ('closed', 'stopped', 'manual_close')
  AND closed_at IS NOT NULL
  LIMIT 20;

  -- Get goal sessions (FIX: use target_value instead of goal_amount->>'target_value')
  SELECT jsonb_build_object(
    'active_sessions', COUNT(*) FILTER (WHERE status IN ('active', 'scanning', 'awaiting_response')),
    'completed_sessions', COUNT(*) FILTER (WHERE status = 'completed'),
    'stuck_sessions', COUNT(*) FILTER (WHERE status = 'scanning' AND created_at < NOW() - INTERVAL '15 minutes'),
    'sessions', COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', id,
        'target_value', target_value,
        'current_progress', COALESCE(current_progress, 0),
        'status', status,
        'created_at', created_at
      )
      ORDER BY created_at DESC
    ) FILTER (WHERE status IN ('active', 'scanning', 'awaiting_response', 'completed')), '[]'::jsonb)
  )
  INTO v_goal_sessions
  FROM goal_sessions
  WHERE user_id = target_user_id;

  -- Build final result
  result := jsonb_build_object(
    'user', jsonb_build_object(
      'user_id', v_user_record.user_id,
      'email', v_user_record.email,
      'created_at', v_user_record.created_at,
      'is_admin', v_user_record.is_admin
    ),
    'balances', jsonb_build_object(
      'account_balance', v_balance_record.account_balance,
      'credit_balance', v_balance_record.credit_balance,
      'lifetime_credits_earned', v_balance_record.lifetime_credits_earned
    ),
    'trade_stats', jsonb_build_object(
      'total_trades', v_trade_stats.total_trades,
      'winning_trades', v_trade_stats.winning_trades,
      'losing_trades', v_trade_stats.losing_trades,
      'win_rate', CASE
        WHEN v_trade_stats.total_trades > 0
        THEN ROUND((v_trade_stats.winning_trades::numeric / v_trade_stats.total_trades::numeric) * 100, 2)
        ELSE 0
      END,
      'net_pnl', v_trade_stats.net_pnl,
      'avg_win', v_trade_stats.avg_win,
      'avg_loss', v_trade_stats.avg_loss
    ),
    'active', jsonb_build_object(
      'active_trades_count', jsonb_array_length(v_active_trades),
      'active_trades', v_active_trades
    ),
    'recent_trades', v_recent_trades,
    'goal_sessions', v_goal_sessions
  );

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_user_details TO authenticated;
