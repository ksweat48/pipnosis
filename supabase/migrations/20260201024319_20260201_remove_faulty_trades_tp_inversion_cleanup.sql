/*
  # Remove Faulty Trades - TP Inversion Bug Cleanup

  ## Summary
  Remove 2 ETHUSD trades from ksweat48@gmail.com account that were affected by 
  the TP inversion bug (take profit prices on wrong side of entry).

  ## Trades to Remove
  1. BUY ETHUSD - ID: b84e152f-bd16-49fa-a72b-ea5f48a908b7
     - Entry: 2457.78, Exit: 2450.52, 3.6 lots
     - Final P&L: -$26.15

  2. SELL ETHUSD - ID: 1fe9c556-8b6e-4ecf-8769-8e52d4f04190
     - Entry: 2406.84, Exit: 2409.50, 1.81 lots
     - Final P&L: -$4.82

  ## Action
  - Delete both trades from goal_session_trades table
  - Refund total lost P&L: $30.97 to user balance
*/

DO $$
DECLARE
  v_user_id UUID;
  v_trade_1_id UUID := 'b84e152f-bd16-49fa-a72b-ea5f48a908b7'::UUID;
  v_trade_2_id UUID := '1fe9c556-8b6e-4ecf-8769-8e52d4f04190'::UUID;
  v_refund_amount NUMERIC := 30.97;
  v_deleted_count INT := 0;
BEGIN
  -- Get user ID
  SELECT id INTO v_user_id FROM auth.users WHERE email = 'ksweat48@gmail.com';

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User ksweat48@gmail.com not found';
  END IF;

  RAISE NOTICE 'Cleaning up faulty ETHUSD trades for ksweat48@gmail.com';
  RAISE NOTICE 'User ID: %', v_user_id;

  -- Delete first trade (BUY ETHUSD)
  DELETE FROM goal_session_trades 
  WHERE id = v_trade_1_id AND user_id = v_user_id;
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  IF v_deleted_count > 0 THEN
    RAISE NOTICE '✓ Deleted BUY ETHUSD trade (ID: %) - lost P&L: $26.15', v_trade_1_id;
  END IF;

  -- Delete second trade (SELL ETHUSD)
  DELETE FROM goal_session_trades 
  WHERE id = v_trade_2_id AND user_id = v_user_id;
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  IF v_deleted_count > 0 THEN
    RAISE NOTICE '✓ Deleted SELL ETHUSD trade (ID: %) - lost P&L: $4.82', v_trade_2_id;
  END IF;

  -- Refund user balance (restore the lost PnL)
  UPDATE user_profiles
  SET 
    account_balance = account_balance + v_refund_amount,
    updated_at = NOW()
  WHERE id = v_user_id;
  
  RAISE NOTICE '✓ Refunded $%.2f to account balance', v_refund_amount;
  RAISE NOTICE '✓ Cleanup complete - Both faulty trades removed';

END $$;
