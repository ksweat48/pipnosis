/*
  # Fix PnL Trigger to Work on Updates

  1. Problem
    - The validate_profit_loss_before_save trigger only fires on INSERT
    - Position closing uses UPDATE, so the trigger never validates/fixes PnL
    - This causes trades to show $0.00 PnL even when they should have values

  2. Solution
    - Update trigger to fire on both INSERT and UPDATE
    - Backfill all existing trades with incorrect PnL

  3. Safety
    - Non-destructive: only fixes zero PnL when entry_price != exit_price
    - Uses existing helper functions for calculations
*/

-- Drop and recreate the trigger to include UPDATE events
DROP TRIGGER IF EXISTS validate_profit_loss_before_save ON goal_session_trades;

CREATE TRIGGER validate_profit_loss_before_save
  BEFORE INSERT OR UPDATE ON goal_session_trades
  FOR EACH ROW
  EXECUTE FUNCTION validate_and_fix_profit_loss();

-- Backfill existing trades with zero PnL that should have non-zero values
DO $$
DECLARE
  v_trade RECORD;
  v_pip_distance numeric;
  v_dollar_per_pip numeric;
  v_calculated_pnl numeric;
  v_fixed_count integer := 0;
BEGIN
  RAISE NOTICE 'Starting PnL backfill for trades with incorrect zero values...';
  
  FOR v_trade IN
    SELECT 
      id,
      symbol,
      direction,
      entry_price,
      exit_price,
      position_size,
      profit_loss,
      current_pnl
    FROM goal_session_trades
    WHERE status = 'closed'
      AND (profit_loss = 0 OR profit_loss IS NULL OR ABS(profit_loss) < 0.01)
      AND entry_price IS NOT NULL
      AND exit_price IS NOT NULL
      AND entry_price != exit_price
      AND position_size > 0
      AND ABS(current_pnl) > 1  -- current_pnl has the correct value
    ORDER BY closed_at DESC
  LOOP
    -- Use the correct current_pnl value if available
    IF v_trade.current_pnl IS NOT NULL AND ABS(v_trade.current_pnl) > 1 THEN
      v_calculated_pnl := v_trade.current_pnl;
    ELSE
      -- Calculate from scratch using helper functions
      v_pip_distance := calculate_pip_distance(
        v_trade.symbol,
        v_trade.entry_price,
        v_trade.exit_price
      );
      
      v_dollar_per_pip := calculate_dollar_per_pip(
        v_trade.symbol,
        v_trade.position_size
      );
      
      IF v_trade.direction = 'buy' THEN
        v_calculated_pnl := v_pip_distance * v_dollar_per_pip;
      ELSE
        v_calculated_pnl := -v_pip_distance * v_dollar_per_pip;
      END IF;
    END IF;
    
    -- Update the trade with correct PnL
    UPDATE goal_session_trades
    SET 
      profit_loss = ROUND(v_calculated_pnl, 2),
      updated_at = now()
    WHERE id = v_trade.id;
    
    v_fixed_count := v_fixed_count + 1;
    
    RAISE NOTICE 'Fixed trade %: % % | Was $% → Now $%',
      SUBSTRING(v_trade.id::text FROM 1 FOR 8),
      v_trade.symbol,
      v_trade.direction,
      ROUND(v_trade.profit_loss, 2),
      ROUND(v_calculated_pnl, 2);
  END LOOP;
  
  RAISE NOTICE '';
  RAISE NOTICE '✅ Backfill complete: % trades fixed', v_fixed_count;
END $$;
