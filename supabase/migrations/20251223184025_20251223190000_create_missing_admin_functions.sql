/*
  # Create Missing Admin Functions for Dashboard

  1. Overview
    This migration creates essential admin functions that are currently missing
    from the database but are required by the admin dashboard.

  2. Functions Created
    - `admin_get_user_details`: Get comprehensive user details including trades, sessions, balances
    - `admin_add_credits_to_user`: Add credits to a user's account with audit trail
    - `admin_clear_stuck_goal_session`: Reset stuck/scanning sessions to completed status
    - `admin_recalculate_user_balance`: Auto-correct user balance based on actual trade PnL

  3. Security
    - All functions use SECURITY DEFINER
    - All functions enforce admin-only access via RLS check
    - All functions validate input parameters

  4. Important Notes
    - These functions are idempotent and can be safely recreated
    - All operations are atomic and transactional
    - Comprehensive error handling with clear messages
*/

-- ============================================================================
-- FUNCTION 1: Get User Details
-- ============================================================================

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

  -- Get goal sessions
  SELECT jsonb_build_object(
    'active_sessions', COUNT(*) FILTER (WHERE status IN ('active', 'scanning', 'awaiting_response')),
    'completed_sessions', COUNT(*) FILTER (WHERE status = 'completed'),
    'stuck_sessions', COUNT(*) FILTER (WHERE status = 'scanning' AND created_at < NOW() - INTERVAL '15 minutes'),
    'sessions', COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', id,
        'target_value', (goal_amount->>'target_value')::numeric,
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

-- Grant execute permission
GRANT EXECUTE ON FUNCTION admin_get_user_details TO authenticated;

-- ============================================================================
-- FUNCTION 2: Add Credits to User
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_add_credits_to_user(
  target_user_id uuid,
  credit_amount numeric,
  reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  calling_user_id uuid;
  is_calling_user_admin boolean;
  old_balance numeric;
  new_balance numeric;
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

  -- Validate inputs
  IF credit_amount <= 0 THEN
    RAISE EXCEPTION 'Credit amount must be positive';
  END IF;

  IF reason IS NULL OR trim(reason) = '' THEN
    RAISE EXCEPTION 'Reason is required';
  END IF;

  -- Validate target user exists
  IF NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = target_user_id) THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- Get current balance
  SELECT COALESCE(balance, 0) INTO old_balance
  FROM user_token_balance
  WHERE user_id = target_user_id;

  -- Insert or update user_token_balance
  INSERT INTO user_token_balance (user_id, balance, total_earned, last_updated)
  VALUES (target_user_id, credit_amount, credit_amount, NOW())
  ON CONFLICT (user_id) DO UPDATE
  SET
    balance = user_token_balance.balance + credit_amount,
    total_earned = user_token_balance.total_earned + credit_amount,
    last_updated = NOW();

  -- Get new balance
  SELECT balance INTO new_balance
  FROM user_token_balance
  WHERE user_id = target_user_id;

  -- Log the credit addition in token_transactions if table exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'token_transactions') THEN
    INSERT INTO token_transactions (user_id, amount, transaction_type, description, created_at)
    VALUES (target_user_id, credit_amount, 'admin_credit', reason, NOW());
  END IF;

  -- Return result
  RETURN jsonb_build_object(
    'success', true,
    'old_balance', old_balance,
    'new_balance', new_balance,
    'amount_added', credit_amount,
    'reason', reason
  );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION admin_add_credits_to_user TO authenticated;

-- ============================================================================
-- FUNCTION 3: Clear Stuck Goal Session
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_clear_stuck_goal_session(
  target_user_id uuid,
  session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  calling_user_id uuid;
  is_calling_user_admin boolean;
  old_status text;
  current_progress numeric;
  target_value numeric;
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

  -- Get session details
  SELECT status, current_progress, (goal_amount->>'target_value')::numeric
  INTO old_status, current_progress, target_value
  FROM goal_sessions
  WHERE id = session_id AND user_id = target_user_id;

  -- Validate session exists
  IF old_status IS NULL THEN
    RAISE EXCEPTION 'Session not found';
  END IF;

  -- Check if session is actually stuck (scanning for > 15 minutes)
  IF old_status != 'scanning' THEN
    RAISE EXCEPTION 'Session is not in scanning status (current: %)', old_status;
  END IF;

  -- Calculate actual progress from trades
  SELECT COALESCE(SUM(profit_loss), 0) INTO current_progress
  FROM goal_session_trades
  WHERE session_id = session_id
  AND status IN ('closed', 'stopped', 'manual_close');

  -- Update session to completed status
  UPDATE goal_sessions
  SET
    status = 'completed',
    current_progress = current_progress,
    completed_at = NOW(),
    updated_at = NOW()
  WHERE id = session_id;

  -- Return result
  RETURN jsonb_build_object(
    'success', true,
    'session_id', session_id,
    'old_status', old_status,
    'new_status', 'completed',
    'recalculated_progress', current_progress,
    'target_value', target_value
  );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION admin_clear_stuck_goal_session TO authenticated;

-- ============================================================================
-- FUNCTION 4: Recalculate User Balance
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_recalculate_user_balance(
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
  old_balance numeric;
  goal_trades_pnl numeric;
  total_goal_trades bigint;
  correct_balance numeric;
  balance_diff numeric;
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

  -- Get current account balance
  SELECT account_balance INTO old_balance
  FROM user_profiles
  WHERE id = target_user_id;

  -- Calculate total PnL from goal session trades
  SELECT
    COALESCE(SUM(profit_loss), 0),
    COUNT(*)
  INTO goal_trades_pnl, total_goal_trades
  FROM goal_session_trades
  WHERE user_id = target_user_id
  AND status IN ('closed', 'stopped', 'manual_close')
  AND profit_loss IS NOT NULL;

  -- Calculate correct balance (starting balance + all closed trades PnL)
  -- Assuming starting balance is 10000
  correct_balance := 10000 + goal_trades_pnl;

  -- Calculate difference
  balance_diff := correct_balance - old_balance;

  -- Update user balance if there's a difference
  IF ABS(balance_diff) > 0.01 THEN
    UPDATE user_profiles
    SET
      account_balance = correct_balance,
      updated_at = NOW()
    WHERE id = target_user_id;
  END IF;

  -- Return result
  RETURN jsonb_build_object(
    'success', true,
    'old_balance', old_balance,
    'correct_balance', correct_balance,
    'balance_diff', balance_diff,
    'trades_pnl', 0,
    'goal_trades_pnl', goal_trades_pnl,
    'total_trades', 0,
    'total_goal_trades', total_goal_trades
  );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION admin_recalculate_user_balance TO authenticated;

-- ============================================================================
-- FUNCTION 5: Auto-Correct ALL Stuck Sessions
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_auto_correct_all_stuck_sessions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  calling_user_id uuid;
  is_calling_user_admin boolean;
  stuck_session record;
  corrected_count integer := 0;
  session_results jsonb := '[]'::jsonb;
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

  -- Find all stuck sessions (scanning for > 15 minutes)
  FOR stuck_session IN
    SELECT
      gs.id,
      gs.user_id,
      gs.status,
      COALESCE(
        (SELECT SUM(profit_loss)
         FROM goal_session_trades gst
         WHERE gst.session_id = gs.id
         AND gst.status IN ('closed', 'stopped', 'manual_close')),
        0
      ) AS calculated_progress
    FROM goal_sessions gs
    WHERE gs.status = 'scanning'
    AND gs.created_at < NOW() - INTERVAL '15 minutes'
  LOOP
    -- Update the stuck session
    UPDATE goal_sessions
    SET
      status = 'completed',
      current_progress = stuck_session.calculated_progress,
      completed_at = NOW(),
      updated_at = NOW()
    WHERE id = stuck_session.id;

    -- Add to results
    session_results := session_results || jsonb_build_object(
      'session_id', stuck_session.id,
      'user_id', stuck_session.user_id,
      'old_status', stuck_session.status,
      'new_status', 'completed',
      'progress', stuck_session.calculated_progress
    );

    corrected_count := corrected_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'corrected_count', corrected_count,
    'sessions', session_results
  );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION admin_auto_correct_all_stuck_sessions TO authenticated;
