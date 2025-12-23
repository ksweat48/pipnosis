/*
  # Auto-Correct Balance for wrkwithnick@gmail.com

  1. Problem
    - User wrkwithnick@gmail.com has incorrect balance
    - Current balance: $9,996.53
    - Should be: $10,290.73 (based on closed trades PnL)
    - Missing: $294.20 in profits
    
  2. Solution
    - Recalculate and update balance for this specific user
    - This is a one-time correction
    
  3. Details
    - 3 closed trades with total PnL: +$290.73
    - Starting balance: $10,000
    - Correct balance: $10,290.73
*/

DO $$
DECLARE
  target_user_id uuid := '58de8b71-c446-4a56-a7eb-41545edafaf2';
  old_balance numeric;
  total_pnl numeric;
  correct_balance numeric;
BEGIN
  -- Get current balance
  SELECT account_balance INTO old_balance
  FROM user_profiles
  WHERE id = target_user_id;
  
  -- Calculate total PnL from closed trades
  SELECT COALESCE(SUM(profit_loss), 0) INTO total_pnl
  FROM goal_session_trades
  WHERE user_id = target_user_id
  AND status IN ('closed', 'stopped', 'manual_close')
  AND profit_loss IS NOT NULL;
  
  -- Calculate correct balance
  correct_balance := 10000 + total_pnl;
  
  -- Update balance
  UPDATE user_profiles
  SET 
    account_balance = correct_balance,
    updated_at = NOW()
  WHERE id = target_user_id;
  
  -- Log the correction
  RAISE NOTICE 'Balance corrected for user %', target_user_id;
  RAISE NOTICE 'Old balance: $%', old_balance;
  RAISE NOTICE 'Total PnL: $%', total_pnl;
  RAISE NOTICE 'New balance: $%', correct_balance;
  RAISE NOTICE 'Difference: $%', (correct_balance - old_balance);
END $$;

-- Verify the correction
DO $$
DECLARE
  current_balance numeric;
  total_pnl numeric;
  expected_balance numeric;
BEGIN
  SELECT account_balance INTO current_balance
  FROM user_profiles
  WHERE id = '58de8b71-c446-4a56-a7eb-41545edafaf2';
  
  SELECT COALESCE(SUM(profit_loss), 0) INTO total_pnl
  FROM goal_session_trades
  WHERE user_id = '58de8b71-c446-4a56-a7eb-41545edafaf2'
  AND status IN ('closed', 'stopped', 'manual_close')
  AND profit_loss IS NOT NULL;
  
  expected_balance := 10000 + total_pnl;
  
  IF ABS(current_balance - expected_balance) > 0.01 THEN
    RAISE EXCEPTION 'Balance verification failed! Current: %, Expected: %', current_balance, expected_balance;
  ELSE
    RAISE NOTICE 'Balance verification PASSED. Balance: $%', current_balance;
  END IF;
END $$;
