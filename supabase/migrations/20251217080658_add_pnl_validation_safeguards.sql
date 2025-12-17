/*
  # Add PnL Validation Safeguards

  1. Purpose
    - Prevent profit_loss from being incorrectly set to 0 when trades are closed
    - Add warnings and automatic recalculation when suspicious PnL values are detected

  2. Changes
    - Add trigger to validate profit_loss before insert/update
    - Automatically recalculate if conditions are met
    - Log warnings for manual review

  3. Safety
    - Non-blocking: automatically fixes issues instead of rejecting updates
    - Preserves intentional $0.00 PnL (when entry_price = exit_price)
*/

-- Create a trigger function to validate and fix profit_loss
CREATE OR REPLACE FUNCTION validate_and_fix_profit_loss()
RETURNS TRIGGER AS $$
DECLARE
  pip_distance numeric;
  dollar_per_pip numeric;
  calculated_pnl numeric;
BEGIN
  -- Only validate when status is 'closed'
  IF NEW.status = 'closed' THEN
    -- Check if profit_loss is 0 but entry/exit prices are different
    IF (NEW.profit_loss = 0 OR NEW.profit_loss IS NULL)
       AND NEW.entry_price IS NOT NULL
       AND NEW.exit_price IS NOT NULL
       AND NEW.entry_price != NEW.exit_price
       AND NEW.position_size > 0 THEN

      RAISE WARNING 'Detected zero PnL for trade % with different entry/exit prices. Recalculating...', NEW.id;

      -- Calculate pip distance
      pip_distance := calculate_pip_distance(NEW.symbol, NEW.entry_price, NEW.exit_price);

      -- Calculate dollar per pip
      dollar_per_pip := calculate_dollar_per_pip(NEW.symbol, NEW.position_size);

      -- Calculate final PnL based on direction
      IF NEW.direction = 'buy' THEN
        calculated_pnl := pip_distance * dollar_per_pip;
      ELSE
        calculated_pnl := -pip_distance * dollar_per_pip;
      END IF;

      -- Update the profit_loss with calculated value
      NEW.profit_loss := calculated_pnl;

      RAISE WARNING 'Auto-corrected PnL for trade %: $% (was $0.00)', NEW.id, ROUND(calculated_pnl, 2);
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop the trigger if it exists
DROP TRIGGER IF EXISTS validate_profit_loss_before_save ON goal_session_trades;

-- Create trigger on goal_session_trades
CREATE TRIGGER validate_profit_loss_before_save
  BEFORE INSERT OR UPDATE ON goal_session_trades
  FOR EACH ROW
  EXECUTE FUNCTION validate_and_fix_profit_loss();

-- Add a check constraint to warn about suspicious zero PnL
-- Note: This is informational only and won't block inserts due to the trigger fixing it first
COMMENT ON COLUMN goal_session_trades.profit_loss IS 'Trade profit/loss in dollars. Automatically validated and recalculated if zero when entry_price != exit_price';

-- Create an index to help find potentially problematic trades quickly
CREATE INDEX IF NOT EXISTS idx_goal_session_trades_zero_pnl_check
  ON goal_session_trades(status, profit_loss)
  WHERE status = 'closed' AND profit_loss = 0;

COMMENT ON INDEX idx_goal_session_trades_zero_pnl_check IS 'Index for monitoring trades with zero PnL (for quality assurance)';
