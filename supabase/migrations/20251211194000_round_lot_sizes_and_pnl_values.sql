/*
  # Round Lot Sizes and PnL Values

  Fix ugly repeating decimals in lot sizes and PnL values by rounding to standard broker precision.

  ## Changes

  1. Round lot_size and position_size columns to 0.01 precision (2 decimal places)
  2. Round current_pnl and profit_loss columns to 0.01 precision (2 decimal places)
  3. Round risk_dollars to 0.01 precision (2 decimal places)

  ## Why This Matters

  - Prevents display of ugly repeating decimals like 0.666666... in UI
  - Matches broker standard of 0.01 lot increments
  - Ensures consistent currency formatting (no $5.666666...)
  - Improves data quality and prevents floating point precision issues

  ## Affected Tables

  - goal_session_trades (main positions table)
*/

-- Round lot_size and position_size to 0.01 precision (2 decimal places)
UPDATE goal_session_trades
SET
  lot_size = ROUND(lot_size::numeric, 2),
  position_size = ROUND(position_size::numeric, 2)
WHERE
  lot_size IS NOT NULL
  OR position_size IS NOT NULL;

-- Round all PnL-related fields to 0.01 precision (2 decimal places for cents)
UPDATE goal_session_trades
SET
  current_pnl = ROUND(current_pnl::numeric, 2),
  profit_loss = ROUND(profit_loss::numeric, 2),
  risk_dollars = ROUND(risk_dollars::numeric, 2)
WHERE
  current_pnl IS NOT NULL
  OR profit_loss IS NOT NULL
  OR risk_dollars IS NOT NULL;

-- Add helpful comment to document precision requirements
COMMENT ON COLUMN goal_session_trades.lot_size IS 'Position size in lots - rounded to 0.01 precision (broker standard)';
COMMENT ON COLUMN goal_session_trades.position_size IS 'Position size in lots - rounded to 0.01 precision (broker standard)';
COMMENT ON COLUMN goal_session_trades.current_pnl IS 'Current profit/loss in USD - rounded to 0.01 precision (cents)';
COMMENT ON COLUMN goal_session_trades.profit_loss IS 'Final profit/loss in USD - rounded to 0.01 precision (cents)';
COMMENT ON COLUMN goal_session_trades.risk_dollars IS 'Risk amount in USD - rounded to 0.01 precision (cents)';
