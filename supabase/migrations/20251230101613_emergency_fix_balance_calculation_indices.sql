/*
  # EMERGENCY: Fix Balance Calculation for Indices
  
  ## CRITICAL BUG
  The close_goal_session_trade() function is using WRONG pip calculations for indices causing:
  - User lost $374 on NAS100 trade
  - Function calculated it as -$374,100 (1000x error)
  - Balance went from $15,000 to -$733,424.40
  
  ## Root Cause
  Function hardcoded:
  - pip_distance = price_diff / 0.0001 (WRONG for indices - should be / 1.0)
  - dollar_per_pip = lot_size * 10 (WRONG for indices - should be * 1)
  
  ## Fix
  1. Replace hardcoded calculations with proper symbol detection
  2. Use correct formulas for each instrument type:
     - Forex (non-JPY): 0.0001 pip, $10 per lot
     - Forex (JPY): 0.01 pip, $1000 per lot
     - Indices (US30, NAS100, SPX500): 1 point, $1 per lot
     - Gold (XAUUSD): 0.01 pip, $100 per lot
     - Crypto: Direct price difference, $1 per contract
  
  3. Restore user balance by recalculating all recent trades
*/

-- Step 1: Fix the close_goal_session_trade function
DROP FUNCTION IF EXISTS close_goal_session_trade(uuid, numeric, text, uuid) CASCADE;

CREATE OR REPLACE FUNCTION close_goal_session_trade(
  p_trade_id uuid,
  p_close_price numeric,
  p_close_reason text DEFAULT 'manual',
  p_goal_session_id uuid DEFAULT NULL
) RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_trade goal_session_trades;
  v_calculated_pnl numeric;
  v_current_balance numeric;
  v_new_balance numeric;
  v_price_diff numeric;
  v_pip_value numeric;
  v_result jsonb;
  v_rows_updated integer;
BEGIN
  IF p_close_reason NOT IN ('manual', 'stop_loss', 'take_profit', 'goal_achieved', 'goal_expired', 'session_ended', 'risk_limit', 'trailing_stop') THEN
    RAISE EXCEPTION 'Invalid close_reason: %', p_close_reason;
  END IF;

  RAISE LOG '[close_goal_session_trade] Starting close for trade %', p_trade_id;

  IF p_goal_session_id IS NOT NULL THEN
    SELECT * INTO v_trade FROM goal_session_trades WHERE id = p_trade_id AND goal_session_id = p_goal_session_id AND status IN ('open', 'pending', 'soft_closing');
  ELSE
    SELECT * INTO v_trade FROM goal_session_trades WHERE id = p_trade_id AND status IN ('open', 'pending', 'soft_closing');
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[close_goal_session_trade] Trade not found or already closed';
  END IF;

  IF v_trade.user_id != auth.uid() AND (auth.jwt() ->> 'role') != 'service_role' THEN
    RAISE EXCEPTION '[close_goal_session_trade] Access denied';
  END IF;

  -- Calculate price difference
  v_price_diff := p_close_price - v_trade.entry_price;

  -- Calculate P&L based on instrument type using SINGLE SOURCE OF TRUTH
  IF v_trade.symbol LIKE '%JPY%' THEN
    -- JPY pairs: 0.01 = 1 pip, $1000 per 1.0 lot
    v_pip_value := (v_price_diff / 0.01) * (COALESCE(v_trade.lot_size, v_trade.position_size, 0.01) * 1000);
  ELSIF v_trade.symbol IN ('US30', 'NAS100', 'SPX500', 'DJI', 'NDX') OR v_trade.symbol LIKE 'US30%' OR v_trade.symbol LIKE 'NAS100%' OR v_trade.symbol LIKE 'SPX500%' THEN
    -- Indices: 1 point = 1 pip, $1 per 1.0 lot
    v_pip_value := v_price_diff * COALESCE(v_trade.lot_size, v_trade.position_size, 0.01);
  ELSIF v_trade.symbol LIKE '%XAU%' OR v_trade.symbol LIKE '%GOLD%' THEN
    -- Gold: 0.01 = 1 pip, $100 per 1.0 lot
    v_pip_value := (v_price_diff / 0.01) * (COALESCE(v_trade.lot_size, v_trade.position_size, 0.01) * 100);
  ELSIF v_trade.symbol LIKE '%BTC%' OR v_trade.symbol LIKE '%ETH%' OR v_trade.symbol LIKE '%CRYPTO%' THEN
    -- Crypto: Direct price difference, $1 per 1.0 contract
    v_pip_value := v_price_diff * COALESCE(v_trade.lot_size, v_trade.position_size, 0.01);
  ELSE
    -- Standard Forex: 0.0001 = 1 pip, $10 per 1.0 lot
    v_pip_value := (v_price_diff / 0.0001) * (COALESCE(v_trade.lot_size, v_trade.position_size, 0.01) * 10);
  END IF;

  -- Apply direction (buy = positive when price up, sell = positive when price down)
  IF v_trade.direction = 'buy' OR v_trade.position_type = 'buy' THEN
    v_calculated_pnl := v_pip_value;
  ELSE
    v_calculated_pnl := -v_pip_value;
  END IF;

  v_calculated_pnl := ROUND(v_calculated_pnl, 2);

  RAISE LOG '[close_goal_session_trade] Symbol: %, Entry: %, Exit: %, Lot: %, Calculated PNL: %', 
    v_trade.symbol, v_trade.entry_price, p_close_price, v_trade.lot_size, v_calculated_pnl;

  UPDATE goal_session_trades
  SET
    status = 'closed',
    exit_price = p_close_price,
    closed_at = now(),
    close_reason = p_close_reason,
    current_price = p_close_price,
    profit_loss = v_calculated_pnl,
    current_pnl = v_calculated_pnl,
    updated_at = now()
  WHERE id = p_trade_id;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    RAISE EXCEPTION '[close_goal_session_trade] Failed to update trade';
  END IF;

  SELECT account_balance INTO v_current_balance FROM user_profiles WHERE id = v_trade.user_id;

  IF v_current_balance IS NULL THEN
    RAISE EXCEPTION '[close_goal_session_trade] User profile not found';
  END IF;

  v_new_balance := v_current_balance + v_calculated_pnl;

  UPDATE user_profiles SET account_balance = v_new_balance, updated_at = now() WHERE id = v_trade.user_id;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    RAISE EXCEPTION '[close_goal_session_trade] Failed to update balance';
  END IF;

  SELECT account_balance INTO v_current_balance FROM user_profiles WHERE id = v_trade.user_id;

  IF v_current_balance != v_new_balance THEN
    RAISE EXCEPTION '[close_goal_session_trade] Balance verification failed';
  END IF;

  RAISE LOG '[close_goal_session_trade] Trade closed successfully. Balance updated from % to %', 
    v_current_balance - v_calculated_pnl, v_current_balance;

  v_result := jsonb_build_object(
    'id', v_trade.id,
    'symbol', v_trade.symbol,
    'direction', COALESCE(v_trade.direction, v_trade.position_type),
    'entry_price', v_trade.entry_price,
    'exit_price', p_close_price,
    'profit_loss', v_calculated_pnl,
    'close_reason', p_close_reason,
    'balance_before', v_current_balance - v_calculated_pnl,
    'balance_after', v_current_balance
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION close_goal_session_trade(uuid, numeric, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION close_goal_session_trade(uuid, numeric, text, uuid) TO service_role;

-- Step 2: Recalculate the contaminated NAS100 trade
DO $$
DECLARE
  v_correct_pnl numeric;
  v_old_pnl numeric;
  v_price_diff numeric;
BEGIN
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE '🚨 EMERGENCY: Recalculating contaminated NAS100 trade';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  
  -- Get the contaminated trade
  SELECT profit_loss INTO v_old_pnl
  FROM goal_session_trades
  WHERE id = '4bc7498b-f72e-4f3f-9521-d6292c06ac96';
  
  -- Recalculate correctly: NAS100 BUY from 25572.57 to 25560.1
  -- Price diff: 25560.1 - 25572.57 = -12.47 points
  -- Lot size: 0.3
  -- P&L: -12.47 × 0.3 × $1 = -$3.74
  v_price_diff := 25560.1 - 25572.573740110198;
  v_correct_pnl := ROUND(v_price_diff * 0.3, 2);
  
  -- Update the trade with correct P&L
  UPDATE goal_session_trades
  SET profit_loss = v_correct_pnl,
      current_pnl = v_correct_pnl,
      updated_at = now()
  WHERE id = '4bc7498b-f72e-4f3f-9521-d6292c06ac96';
  
  RAISE NOTICE '  Trade 4bc7498b corrected:';
  RAISE NOTICE '    Old P&L: $%', v_old_pnl;
  RAISE NOTICE '    Correct P&L: $%', v_correct_pnl;
  RAISE NOTICE '    Correction: $%', v_correct_pnl - v_old_pnl;
  RAISE NOTICE '';
END $$;

-- Step 3: Restore user balance by recalculating from all trades
DO $$
DECLARE
  v_user_id uuid := '91905a02-cf9e-4537-9920-98a4b790830a';
  v_starting_balance numeric := 15000.00; -- User's stated balance before the trade
  v_total_pnl numeric;
  v_correct_balance numeric;
  v_current_balance numeric;
BEGIN
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE '🔧 RESTORING USER BALANCE';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  
  -- Calculate total P&L from all closed trades in last 24 hours
  SELECT COALESCE(SUM(profit_loss), 0)
  INTO v_total_pnl
  FROM goal_session_trades
  WHERE user_id = v_user_id
    AND status = 'closed'
    AND closed_at > NOW() - INTERVAL '24 hours';
  
  v_correct_balance := v_starting_balance + v_total_pnl;
  
  SELECT account_balance INTO v_current_balance FROM user_profiles WHERE id = v_user_id;
  
  RAISE NOTICE '  Starting balance: $%', v_starting_balance;
  RAISE NOTICE '  Total P&L (24h): $%', v_total_pnl;
  RAISE NOTICE '  Correct balance: $%', v_correct_balance;
  RAISE NOTICE '  Current balance: $%', v_current_balance;
  RAISE NOTICE '  Correction needed: $%', v_correct_balance - v_current_balance;
  RAISE NOTICE '';
  
  -- Restore correct balance
  UPDATE user_profiles
  SET account_balance = v_correct_balance,
      updated_at = now()
  WHERE id = v_user_id;
  
  RAISE NOTICE '✅ Balance restored to $%', v_correct_balance;
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
END $$;
