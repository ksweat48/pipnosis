/*
  # Emergency Fix: XAUUSD Trade P&L Corruption and Balance Restoration

  ## Incident
  Trade d2c76fb8 P&L calculated as -$22,977.00 (100x error). Correct: -$229.77.

  ## Corrections
  1. Trade profit_loss: -22977.00 -> -229.77
  2. User balance: += 22747.23
  3. Closure event pnl: -22977.00 -> -229.77
*/

DO $$
DECLARE
  v_wrong_pnl numeric := -22977.00;
  v_correct_pnl numeric := -229.77;
  v_pnl_correction numeric;
  v_trade_id uuid := 'd2c76fb8-8832-4510-8dcd-5fac627c3214';
  v_user_id uuid := '91905a02-cf9e-4537-9920-98a4b790830a';
  v_old_balance numeric;
  v_new_balance numeric;
BEGIN
  v_pnl_correction := v_correct_pnl - v_wrong_pnl;

  IF NOT EXISTS (
    SELECT 1 FROM goal_session_trades
    WHERE id = v_trade_id AND profit_loss = v_wrong_pnl AND status = 'closed'
  ) THEN
    RAISE EXCEPTION 'Trade does not have expected P&L - aborting';
  END IF;

  UPDATE goal_session_trades
  SET profit_loss = v_correct_pnl, current_pnl = v_correct_pnl, updated_at = now()
  WHERE id = v_trade_id;

  SELECT account_balance INTO v_old_balance FROM user_profiles WHERE id = v_user_id;
  v_new_balance := v_old_balance + v_pnl_correction;

  UPDATE user_profiles
  SET account_balance = v_new_balance, updated_at = now()
  WHERE id = v_user_id;

  UPDATE trade_closure_events
  SET pnl = v_correct_pnl
  WHERE trade_id = v_trade_id AND pnl = v_wrong_pnl;

  INSERT INTO governance_change_log (
    entity_type, entity_id, operation, reason, old_value, new_value, metadata
  ) VALUES (
    'goal_session_trades',
    v_trade_id,
    'system_recovery',
    'XAUUSD P&L corrected from -$22,977 to -$229.77 (RPC 100x formula error). Balance restored.',
    jsonb_build_object('profit_loss', v_wrong_pnl, 'balance', v_old_balance),
    jsonb_build_object('profit_loss', v_correct_pnl, 'balance', v_new_balance),
    jsonb_build_object(
      'user_id', v_user_id::text,
      'pnl_correction', v_pnl_correction,
      'root_cause', 'RPC used (diff/0.01)*(lot*100) instead of diff*lot*100 for XAUUSD'
    )
  );
END $$;
