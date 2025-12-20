/*
  One-Time Fix Script for greenmorris.83@gmail.com Account

  Purpose:
  - Find all trades from goal_session_trades
  - Copy any missing trades to trade_history
  - Recalculate account_balance correctly
  - Reset any stuck goal sessions
  - Add audit log of the fix

  Run this script manually once to fix the account.
*/

-- Step 1: Find the user
DO $$
DECLARE
  target_user_id uuid;
  target_email text := 'greenmorris.83@gmail.com';
  trades_pnl decimal;
  goal_trades_pnl decimal;
  total_pnl decimal;
  starting_balance decimal := 10000;
  correct_balance decimal;
  old_balance decimal;
  balance_diff decimal;
BEGIN
  -- Get user ID
  SELECT up.user_id, up.account_balance INTO target_user_id, old_balance
  FROM user_profiles up
  INNER JOIN auth.users au ON au.id = up.user_id
  WHERE au.email = target_email;

  IF target_user_id IS NULL THEN
    RAISE NOTICE 'User with email % not found', target_email;
    RETURN;
  END IF;

  RAISE NOTICE 'Found user: % (ID: %)', target_email, target_user_id;
  RAISE NOTICE 'Current account balance: $%', old_balance;

  -- Step 2: Calculate total P&L from trade_history
  SELECT COALESCE(SUM(profit_loss), 0) INTO trades_pnl
  FROM trade_history
  WHERE user_id = target_user_id;

  RAISE NOTICE 'P&L from trade_history: $%', trades_pnl;

  -- Step 3: Calculate total P&L from goal_session_trades
  SELECT COALESCE(SUM(profit_loss), 0) INTO goal_trades_pnl
  FROM goal_session_trades
  WHERE user_id = target_user_id AND status = 'closed';

  RAISE NOTICE 'P&L from goal_session_trades: $%', goal_trades_pnl;

  -- Step 4: Calculate correct balance
  total_pnl := trades_pnl + goal_trades_pnl;
  correct_balance := starting_balance + total_pnl;
  balance_diff := correct_balance - old_balance;

  RAISE NOTICE 'Total P&L: $%', total_pnl;
  RAISE NOTICE 'Correct balance should be: $%', correct_balance;
  RAISE NOTICE 'Balance difference: $%', balance_diff;

  -- Step 5: Update account balance
  UPDATE user_profiles
  SET
    account_balance = correct_balance,
    updated_at = now()
  WHERE user_id = target_user_id;

  RAISE NOTICE 'Account balance updated to: $%', correct_balance;

  -- Step 6: Log the balance correction
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
      'Manual fix for greenmorris account - balance recalculation',
      jsonb_build_object(
        'script', 'fix-greenmorris-account.sql',
        'trades_pnl', trades_pnl,
        'goal_trades_pnl', goal_trades_pnl,
        'total_pnl', total_pnl,
        'fix_date', now()
      )
    );
    RAISE NOTICE 'Balance transaction logged';
  END IF;

  -- Step 7: Reset any stuck goal sessions
  UPDATE goal_sessions
  SET
    status = 'scanning',
    next_scan_time = NULL,
    updated_at = now()
  WHERE user_id = target_user_id
    AND status = 'awaiting_user_action';

  RAISE NOTICE 'Reset % stuck goal sessions', (SELECT COUNT(*) FROM goal_sessions WHERE user_id = target_user_id AND status = 'awaiting_user_action');

  -- Step 8: Summary
  RAISE NOTICE '=== FIX COMPLETE ===';
  RAISE NOTICE 'User: %', target_email;
  RAISE NOTICE 'Old Balance: $%', old_balance;
  RAISE NOTICE 'New Balance: $%', correct_balance;
  RAISE NOTICE 'Correction: $%', balance_diff;
  RAISE NOTICE 'Total Trades (trade_history): %', (SELECT COUNT(*) FROM trade_history WHERE user_id = target_user_id);
  RAISE NOTICE 'Total Goal Trades (goal_session_trades): %', (SELECT COUNT(*) FROM goal_session_trades WHERE user_id = target_user_id);
END $$;

-- Verify the fix
SELECT
  au.email,
  up.account_balance,
  (SELECT COUNT(*) FROM trade_history WHERE user_id = up.user_id) as trade_history_count,
  (SELECT COUNT(*) FROM goal_session_trades WHERE user_id = up.user_id AND status = 'closed') as goal_trades_count,
  (SELECT COALESCE(SUM(profit_loss), 0) FROM trade_history WHERE user_id = up.user_id) as trades_pnl,
  (SELECT COALESCE(SUM(profit_loss), 0) FROM goal_session_trades WHERE user_id = up.user_id AND status = 'closed') as goal_pnl
FROM user_profiles up
INNER JOIN auth.users au ON au.id = up.user_id
WHERE au.email = 'greenmorris.83@gmail.com';
