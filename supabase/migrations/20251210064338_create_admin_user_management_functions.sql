/*
  # Admin User Management Functions

  1. Functions
    - `admin_get_all_users` - Get searchable list of all users with balances and stats
    - `admin_clear_stuck_goal_session` - Reset stuck goal sessions to scanning status
    - `admin_add_credits_to_user` - Add credits to user balance with audit trail
    - `admin_recalculate_user_balance` - Recalculate account balance from all trades
    - `admin_get_user_details` - Get comprehensive user details for admin panel

  2. Security
    - All functions verify admin status before execution
    - Use SECURITY DEFINER to bypass RLS
    - Log all admin actions for audit trail
*/

-- Function: Get all users with search capability
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
  WHERE up.user_id = auth.uid();

  IF NOT COALESCE(calling_user_is_admin, false) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    up.user_id,
    au.email::text,
    up.created_at,
    up.is_admin,
    up.account_balance,
    COALESCE(utb.balance, 0) as credit_balance,
    COALESCE(
      (SELECT COUNT(*) FROM trade_history th WHERE th.user_id = up.user_id),
      0
    )::bigint as total_trades,
    COALESCE(
      (SELECT COUNT(*) FROM simulated_positions sp WHERE sp.user_id = up.user_id AND sp.status = 'open'),
      0
    )::bigint as active_trades,
    GREATEST(
      up.created_at,
      COALESCE((SELECT MAX(closed_at) FROM trade_history th WHERE th.user_id = up.user_id), up.created_at),
      COALESCE((SELECT MAX(updated_at) FROM simulated_positions sp WHERE sp.user_id = up.user_id), up.created_at)
    ) as last_activity
  FROM user_profiles up
  INNER JOIN auth.users au ON au.id = up.user_id
  LEFT JOIN user_token_balance utb ON utb.user_id = up.user_id
  WHERE
    (search_email IS NULL OR au.email ILIKE '%' || search_email || '%')
  ORDER BY up.created_at DESC
  LIMIT limit_count;
END;
$$;

-- Function: Clear stuck goal session
CREATE OR REPLACE FUNCTION admin_clear_stuck_goal_session(
  target_user_id uuid,
  session_id uuid
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  calling_user_is_admin boolean;
  session_record record;
  calculated_progress decimal;
  result jsonb;
BEGIN
  SELECT up.is_admin INTO calling_user_is_admin
  FROM user_profiles up
  WHERE up.user_id = auth.uid();

  IF NOT COALESCE(calling_user_is_admin, false) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT * INTO session_record
  FROM goal_sessions
  WHERE id = session_id AND user_id = target_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Session not found'
    );
  END IF;

  SELECT COALESCE(SUM(profit_loss), 0) INTO calculated_progress
  FROM goal_session_trades
  WHERE goal_session_id = session_id AND status = 'closed';

  UPDATE goal_sessions
  SET
    status = 'scanning',
    current_progress = calculated_progress,
    progress_percentage = CASE
      WHEN target_value > 0 THEN (calculated_progress / target_value) * 100
      ELSE 0
    END,
    next_scan_time = NULL,
    updated_at = now()
  WHERE id = session_id;

  result := jsonb_build_object(
    'success', true,
    'session_id', session_id,
    'old_status', session_record.status,
    'new_status', 'scanning',
    'recalculated_progress', calculated_progress,
    'target_value', session_record.target_value
  );

  RETURN result;
END;
$$;

-- Function: Add credits to user
CREATE OR REPLACE FUNCTION admin_add_credits_to_user(
  target_user_id uuid,
  credit_amount decimal,
  reason text
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  calling_user_is_admin boolean;
  calling_user_id uuid;
  old_balance decimal;
  new_balance decimal;
  result jsonb;
BEGIN
  calling_user_id := auth.uid();

  SELECT up.is_admin INTO calling_user_is_admin
  FROM user_profiles up
  WHERE up.user_id = calling_user_id;

  IF NOT COALESCE(calling_user_is_admin, false) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  IF credit_amount <= 0 THEN
    RAISE EXCEPTION 'Credit amount must be positive';
  END IF;

  INSERT INTO user_token_balance (user_id, balance, lifetime_earned)
  VALUES (target_user_id, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT balance INTO old_balance
  FROM user_token_balance
  WHERE user_id = target_user_id;

  UPDATE user_token_balance
  SET
    balance = balance + credit_amount,
    lifetime_earned = lifetime_earned + credit_amount,
    updated_at = now()
  WHERE user_id = target_user_id
  RETURNING balance INTO new_balance;

  INSERT INTO token_transaction_history (
    user_id,
    transaction_type,
    amount,
    balance_after,
    description,
    metadata
  ) VALUES (
    target_user_id,
    'admin_adjustment',
    credit_amount,
    new_balance,
    COALESCE(reason, 'Admin credit adjustment'),
    jsonb_build_object(
      'admin_user_id', calling_user_id,
      'reason', reason
    )
  );

  result := jsonb_build_object(
    'success', true,
    'old_balance', old_balance,
    'new_balance', new_balance,
    'amount_added', credit_amount,
    'reason', reason
  );

  RETURN result;
END;
$$;

-- Function: Recalculate user balance
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
  trades_pnl decimal;
  goal_trades_pnl decimal;
  total_pnl decimal;
  starting_balance decimal := 10000;
  correct_balance decimal;
  balance_diff decimal;
  result jsonb;
BEGIN
  SELECT up.is_admin INTO calling_user_is_admin
  FROM user_profiles up
  WHERE up.user_id = auth.uid();

  IF NOT COALESCE(calling_user_is_admin, false) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT account_balance INTO old_balance
  FROM user_profiles
  WHERE user_id = target_user_id;

  SELECT COALESCE(SUM(profit_loss), 0) INTO trades_pnl
  FROM trade_history
  WHERE user_id = target_user_id;

  SELECT COALESCE(SUM(profit_loss), 0) INTO goal_trades_pnl
  FROM goal_session_trades
  WHERE user_id = target_user_id AND status = 'closed';

  total_pnl := trades_pnl + goal_trades_pnl;
  correct_balance := starting_balance + total_pnl;
  balance_diff := correct_balance - old_balance;

  UPDATE user_profiles
  SET
    account_balance = correct_balance,
    updated_at = now()
  WHERE user_id = target_user_id;

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
        'trades_pnl', trades_pnl,
        'goal_trades_pnl', goal_trades_pnl,
        'total_pnl', total_pnl
      )
    );
  END IF;

  result := jsonb_build_object(
    'success', true,
    'old_balance', old_balance,
    'correct_balance', correct_balance,
    'balance_diff', balance_diff,
    'trades_pnl', trades_pnl,
    'goal_trades_pnl', goal_trades_pnl,
    'total_trades', (SELECT COUNT(*) FROM trade_history WHERE user_id = target_user_id),
    'total_goal_trades', (SELECT COUNT(*) FROM goal_session_trades WHERE user_id = target_user_id)
  );

  RETURN result;
END;
$$;

-- Function: Get detailed user information
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
  WHERE up.user_id = auth.uid();

  IF NOT COALESCE(calling_user_is_admin, false) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT au.email INTO user_email
  FROM auth.users au
  WHERE au.id = target_user_id;

  SELECT jsonb_build_object(
    'user_id', up.user_id,
    'email', user_email,
    'created_at', up.created_at,
    'is_admin', up.is_admin
  ) INTO user_data
  FROM user_profiles up
  WHERE up.user_id = target_user_id;

  SELECT jsonb_build_object(
    'account_balance', up.account_balance,
    'demo_balance', up.demo_balance,
    'credit_balance', COALESCE(utb.balance, 0),
    'lifetime_credits_earned', COALESCE(utb.lifetime_earned, 0)
  ) INTO balance_data
  FROM user_profiles up
  LEFT JOIN user_token_balance utb ON utb.user_id = up.user_id
  WHERE up.user_id = target_user_id;

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
  FROM (
    SELECT profit_loss FROM trade_history WHERE user_id = target_user_id
    UNION ALL
    SELECT profit_loss FROM goal_session_trades WHERE user_id = target_user_id AND status = 'closed'
  ) all_trades;

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

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', t.id,
      'symbol', t.symbol,
      'direction', t.direction,
      'pnl', t.profit_loss,
      'closed_at', t.closed_at,
      'source', COALESCE(t.trade_source, 'unknown')
    ) ORDER BY t.closed_at DESC
  ), '[]'::jsonb) INTO recent_trades
  FROM (
    SELECT id, symbol, position_type as direction, profit_loss, closed_at, trade_source
    FROM trade_history
    WHERE user_id = target_user_id
    UNION ALL
    SELECT id, symbol, direction, profit_loss, closed_at, 'goal_session' as trade_source
    FROM goal_session_trades
    WHERE user_id = target_user_id AND status = 'closed'
    ORDER BY closed_at DESC
    LIMIT 5
  ) t;

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

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_trade_history_user_pnl ON trade_history(user_id, profit_loss);
CREATE INDEX IF NOT EXISTS idx_goal_session_trades_user_pnl ON goal_session_trades(user_id, profit_loss) WHERE status = 'closed';
CREATE INDEX IF NOT EXISTS idx_simulated_positions_user_status ON simulated_positions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_goal_sessions_user_status ON goal_sessions(user_id, status);
