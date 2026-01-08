/*
  # Fix XAUUSD 100x Decimal Error - Surgical Correction

  ## Problem
  Multiple XAUUSD trades recorded P&L with 100x error due to database using pipValue: 0.01
  while TypeScript uses pipValue: 1.0 for XAUUSD.

  ## Root Cause
  Database SSOT function calculate_pip_distance() treated XAUUSD like JPY pairs (0.01 pip value)
  when it should use 1.0 pip value to match TypeScript standard (1 pip = 1 point for gold).

  ## Architectural Decision: TypeScript Standard (1 pip = 1 point)
  - Natural for LLM reasoning: "20 pip stop" = 20 price points
  - Matches trader thinking: Gold moves in dollar increments
  - Already working correctly in frontend
  - Less error-prone than fractional pips

  ## Affected Trades
  1. a966dec5-2877-4a00-8e71-9e525854303d - P&L: $9,752.40 → $97.52
  2. f7276c1a-e2c2-4ce8-94c8-fbe327df1a7f - P&L: -$15,367.95 → -$153.68
  3. 6448fc91-bcdd-4afa-818e-2e9706c112c5 - P&L: $12,642.00 → $126.42

  ## Changes
  1. Fix calculate_pip_distance() to use pip_value = 1.0 for XAUUSD/XAGUSD
  2. Recalculate all 3 affected trades
  3. Update ai_trade_journal for all trades
  4. Update user balances for all affected users
  5. Recalculate goal session progress
  6. Create audit records
  7. Add validation constraint to prevent future 100x errors
*/

-- Step 1: Drop and recreate the SSOT function for pip distance calculation
DROP FUNCTION IF EXISTS calculate_pip_distance(text, numeric, numeric);

CREATE FUNCTION calculate_pip_distance(
  p_symbol text,
  p_entry_price numeric,
  p_exit_price numeric
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_sym text := UPPER(TRIM(p_symbol));
  v_pip numeric;
BEGIN
  -- CRITICAL: XAUUSD/XAGUSD use pip_value = 1.0 (TypeScript standard)
  -- This matches trader thinking: 1 pip = 1 price point for gold/silver
  -- JPY pairs still use 0.01 as they're quoted to 3 decimal places

  IF v_sym LIKE '%JPY%' THEN
    v_pip := 0.01; -- JPY pairs: 0.01 pip value
  ELSIF v_sym IN ('XAUUSD', 'XAGUSD') THEN
    v_pip := 1.0; -- Gold/Silver: 1 pip = 1 point (NOT 0.01)
  ELSIF v_sym IN ('BTCUSD', 'ETHUSD', 'BTCUSDT', 'ETHUSDT') THEN
    v_pip := 1.0; -- Crypto: 1 pip = 1 point
  ELSE
    v_pip := 0.0001; -- Standard forex: 4 decimal places
  END IF;

  RETURN ABS(p_exit_price - p_entry_price) / v_pip;
END;
$$;

-- Step 2: Fix all XAUUSD trades with 100x error
DO $$
DECLARE
  v_trade record;
  v_correct_pnl numeric;
  v_pnl_difference numeric;
  v_old_balance numeric;
  v_new_balance numeric;
  v_total_fixed integer := 0;
BEGIN
  -- Loop through all violating trades
  FOR v_trade IN
    SELECT 
      t.id,
      t.goal_session_id,
      t.user_id,
      t.symbol,
      t.direction,
      t.entry_price,
      t.exit_price,
      t.lot_size,
      t.profit_loss as old_pnl
    FROM goal_session_trades t
    WHERE t.symbol = 'XAUUSD'
      AND ABS(t.profit_loss) > (t.lot_size * 5000)
  LOOP
    -- Calculate correct P&L
    v_correct_pnl := calculate_pnl_universal(
      v_trade.symbol,
      v_trade.direction,
      v_trade.entry_price,
      v_trade.exit_price,
      v_trade.lot_size
    );

    v_pnl_difference := v_correct_pnl - v_trade.old_pnl;

    -- Get current user balance
    SELECT account_balance INTO v_old_balance
    FROM user_profiles
    WHERE id = v_trade.user_id;

    v_new_balance := v_old_balance + v_pnl_difference;

    -- Update the trade record
    UPDATE goal_session_trades
    SET
      profit_loss = v_correct_pnl,
      current_pnl = v_correct_pnl,
      updated_at = now()
    WHERE id = v_trade.id;

    -- Update AI trade journal if exists
    UPDATE ai_trade_journal
    SET
      pnl = v_correct_pnl,
      updated_at = now()
    WHERE trade_id = v_trade.id;

    -- Update user balance
    UPDATE user_profiles
    SET
      account_balance = v_new_balance,
      updated_at = now()
    WHERE id = v_trade.user_id;

    -- Create audit record
    INSERT INTO pip_calculation_audit (
      trade_id,
      goal_session_id,
      user_id,
      symbol,
      direction,
      entry_price,
      exit_price,
      lot_size,
      old_pnl,
      new_pnl,
      pnl_difference,
      correction_reason
    ) VALUES (
      v_trade.id,
      v_trade.goal_session_id,
      v_trade.user_id,
      v_trade.symbol,
      v_trade.direction,
      v_trade.entry_price,
      v_trade.exit_price,
      v_trade.lot_size,
      v_trade.old_pnl,
      v_correct_pnl,
      v_pnl_difference,
      'XAUUSD 100x decimal error - Fixed pip definition from 0.01 to 1.0 to match TypeScript standard. Trade recorded $' || 
      ROUND(v_trade.old_pnl, 2) || ' instead of $' || ROUND(v_correct_pnl, 2) || 
      ' due to database treating XAUUSD like JPY pairs. User balance adjusted from $' || 
      ROUND(v_old_balance, 2) || ' to $' || ROUND(v_new_balance, 2) || ' (change: $' || ROUND(v_pnl_difference, 2) || ').'
    );

    -- Recalculate goal session progress if session exists
    IF v_trade.goal_session_id IS NOT NULL THEN
      UPDATE goal_sessions gs
      SET
        current_progress = (
          SELECT COALESCE(SUM(profit_loss), 0)
          FROM goal_session_trades
          WHERE goal_session_id = gs.id AND status = 'closed'
        ),
        updated_at = now()
      WHERE id = v_trade.goal_session_id;
    END IF;

    v_total_fixed := v_total_fixed + 1;

    -- Log the correction
    RAISE NOTICE 'XAUUSD 100x error corrected for trade %:', v_trade.id;
    RAISE NOTICE '  User ID: %', v_trade.user_id;
    RAISE NOTICE '  Old P&L: $%', v_trade.old_pnl;
    RAISE NOTICE '  Correct P&L: $%', v_correct_pnl;
    RAISE NOTICE '  P&L Adjustment: $%', v_pnl_difference;
    RAISE NOTICE '  Old Balance: $%', v_old_balance;
    RAISE NOTICE '  New Balance: $%', v_new_balance;
    RAISE NOTICE '---';
  END LOOP;

  RAISE NOTICE 'Total trades fixed: %', v_total_fixed;
END;
$$;

-- Step 3: NOW add validation constraint to prevent future 100x errors
-- XAUUSD trades should have reasonable P&L relative to lot size
-- Max realistic P&L: lot_size × $5,000 (500 pips at $10/pip)
ALTER TABLE goal_session_trades
DROP CONSTRAINT IF EXISTS check_xauusd_pnl_reasonable;

ALTER TABLE goal_session_trades
ADD CONSTRAINT check_xauusd_pnl_reasonable
CHECK (
  symbol != 'XAUUSD' OR
  ABS(profit_loss) <= (lot_size * 5000)
);

-- Step 4: Create index for future audits
CREATE INDEX IF NOT EXISTS idx_trades_xauusd_high_pnl
ON goal_session_trades(symbol, profit_loss)
WHERE symbol = 'XAUUSD' AND ABS(profit_loss) > 1000;

-- Step 5: Add comment to function
COMMENT ON FUNCTION calculate_pip_distance IS
'SSOT for pip distance calculation. CRITICAL: XAUUSD/XAGUSD use pip_value = 1.0 (TypeScript standard).
This matches trader thinking where 1 pip = 1 price point for gold/silver.
Updated Jan 8, 2026 to fix 100x decimal error where database used 0.01 instead of 1.0.';
