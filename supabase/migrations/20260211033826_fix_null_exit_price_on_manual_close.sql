/*
  # Fix NULL Exit Price on Manual Close

  ## Issue
  When manually closing trades, if the realtime_prices table returns a row with NULL bid/ask,
  the frontend passes NULL as p_close_price to close_goal_session_trade RPC, resulting in:
  - exit_price: NULL
  - Incorrect P&L calculation (shows -$0.02 instead of actual -$206)

  ## Root Cause
  Frontend code did not validate that bid/ask from realtime_prices is a valid number before
  passing to the close RPC.

  ## Fix (Frontend - Already Applied)
  - GoalSessionDashboard.tsx: Added validation that closePrice is valid number > 0
  - PositionsPage.tsx: Added same validation for all close flows
  - Both now fallback to trade.current_price if realtime price is NULL/invalid

  ## Database Repair
  1. Identify trades with NULL exit_price but valid current_price
  2. Backfill exit_price from current_price
  3. Recalculate P&L using the correct exit price
  4. Add constraint to prevent future NULL exit_price on closed trades

  ## CCIP Compliance
  - System Map: Traced manual close flow through UI -> RPC -> DB
  - Logic Contract: exit_price must always be set when status = 'closed'
  - Governance: Add NOT NULL constraint for exit_price on closed trades (via trigger)
*/

-- Step 1: Repair corrupted closed trades (exit_price NULL but status = 'closed')
DO $$
DECLARE
  v_trade RECORD;
  v_calculated_pnl numeric;
  v_price_diff numeric;
  v_pip_value numeric;
BEGIN
  FOR v_trade IN 
    SELECT id, user_id, symbol, direction, entry_price, current_price, lot_size, position_size, close_reason
    FROM goal_session_trades
    WHERE status = 'closed'
      AND exit_price IS NULL
      AND current_price IS NOT NULL
      AND current_price > 0
  LOOP
    RAISE NOTICE 'Repairing trade %: % % (exit_price NULL -> %)', 
      v_trade.id, v_trade.symbol, v_trade.direction, v_trade.current_price;

    -- Calculate correct P&L using current_price as exit_price
    v_price_diff := v_trade.current_price - v_trade.entry_price;

    -- Use same pip calculation logic as close_goal_session_trade RPC
    IF v_trade.symbol LIKE '%JPY%' THEN
      v_pip_value := (v_price_diff / 0.01) * (COALESCE(v_trade.lot_size, v_trade.position_size, 0.01) * 1000);
    ELSIF v_trade.symbol IN ('US30', 'NAS100', 'SPX500', 'DJI', 'NDX') OR v_trade.symbol LIKE 'US30%' OR v_trade.symbol LIKE 'NAS100%' OR v_trade.symbol LIKE 'SPX500%' THEN
      v_pip_value := v_price_diff * COALESCE(v_trade.lot_size, v_trade.position_size, 0.01);
    ELSIF v_trade.symbol LIKE '%XAU%' OR v_trade.symbol LIKE '%GOLD%' THEN
      v_pip_value := (v_price_diff / 0.01) * (COALESCE(v_trade.lot_size, v_trade.position_size, 0.01) * 100);
    ELSIF v_trade.symbol LIKE '%BTC%' OR v_trade.symbol LIKE '%ETH%' OR v_trade.symbol LIKE '%CRYPTO%' THEN
      v_pip_value := v_price_diff * COALESCE(v_trade.lot_size, v_trade.position_size, 0.01);
    ELSIF v_trade.symbol LIKE '%XAG%' OR v_trade.symbol LIKE '%SILVER%' THEN
      v_pip_value := (v_price_diff / 0.001) * (COALESCE(v_trade.lot_size, v_trade.position_size, 0.01) * 50);
    ELSE
      v_pip_value := (v_price_diff / 0.0001) * (COALESCE(v_trade.lot_size, v_trade.position_size, 0.01) * 10);
    END IF;

    IF v_trade.direction = 'buy' THEN
      v_calculated_pnl := v_pip_value;
    ELSE
      v_calculated_pnl := -v_pip_value;
    END IF;

    v_calculated_pnl := ROUND(v_calculated_pnl, 2);

    -- Update the trade with correct exit_price and profit_loss
    UPDATE goal_session_trades
    SET 
      exit_price = v_trade.current_price,
      profit_loss = v_calculated_pnl,
      current_pnl = v_calculated_pnl,
      updated_at = now()
    WHERE id = v_trade.id;

    RAISE NOTICE 'Repaired trade %: exit_price set to %, P&L corrected to $%', 
      v_trade.id, v_trade.current_price, v_calculated_pnl;
  END LOOP;
END $$;

-- Step 2: Create trigger to prevent future NULL exit_price on closed trades
CREATE OR REPLACE FUNCTION prevent_null_exit_price_on_close()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'closed' AND NEW.exit_price IS NULL THEN
    -- If current_price is available, use it as fallback
    IF NEW.current_price IS NOT NULL AND NEW.current_price > 0 THEN
      RAISE WARNING '[GOVERNANCE] Trade % closed with NULL exit_price, using current_price % as fallback',
        NEW.id, NEW.current_price;
      NEW.exit_price := NEW.current_price;
    ELSE
      RAISE EXCEPTION '[GOVERNANCE VIOLATION] Cannot close trade % with NULL exit_price and no valid current_price. close_reason: %',
        NEW.id, NEW.close_reason;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Drop trigger if exists and recreate
DROP TRIGGER IF EXISTS enforce_exit_price_on_close ON goal_session_trades;
CREATE TRIGGER enforce_exit_price_on_close
  BEFORE UPDATE OF status
  ON goal_session_trades
  FOR EACH ROW
  WHEN (NEW.status = 'closed' AND OLD.status != 'closed')
  EXECUTE FUNCTION prevent_null_exit_price_on_close();

COMMENT ON TRIGGER enforce_exit_price_on_close ON goal_session_trades IS
  'GOVERNANCE: Prevents trades from being closed with NULL exit_price. Uses current_price as fallback or blocks the close.';

-- Step 3: Log the repair action
INSERT INTO ssot_violations (
  violation_type,
  symbol,
  attempted_operation,
  call_location,
  blocked,
  error_details
)
SELECT 
  'NULL_EXIT_PRICE_REPAIR',
  symbol,
  'manual_close',
  'fix_null_exit_price_migration',
  false,
  jsonb_build_object(
    'trade_id', id,
    'repaired_exit_price', exit_price,
    'corrected_pnl', profit_loss,
    'close_reason', close_reason,
    'note', 'Backfilled exit_price from current_price, recalculated P&L'
  )
FROM goal_session_trades
WHERE status = 'closed'
  AND exit_price IS NOT NULL
  AND updated_at > now() - interval '1 minute';
