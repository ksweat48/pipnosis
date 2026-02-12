/*
  # Add Planned Price Audit Columns to goal_session_trades

  CCIP (2026-02-12): Trade Execution Geometry Preservation

  ## Problem
  When Alpha plans a trade at entry X with SL/TP, and the actual market fill
  is at price Y, the SL/TP (which are absolute price levels) become invalid.
  If entry moves far enough, SL can end up on the wrong side of entry, causing
  immediate SL hits.

  ## Solution
  1. Store Alpha's PLANNED prices alongside actual execution prices
  2. At execution time, SL/TP are recalculated to maintain Alpha's intended
     pip distances from the actual fill price
  3. These audit columns enable post-trade analysis of entry deviation

  ## New Columns
  - `planned_entry_price` (numeric, nullable) - Alpha's originally planned entry
  - `planned_stop_loss` (numeric, nullable) - Alpha's originally planned SL
  - `planned_take_profit` (numeric, nullable) - Alpha's originally planned TP

  ## Notes
  - Nullable for backward compatibility with existing trades
  - Existing trades will have NULL values (no backfill needed)
  - New trades will always have these fields populated
  - The actual entry_price, stop_loss, take_profit columns contain
    the EXECUTION values (recalculated if needed)
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'planned_entry_price'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN planned_entry_price numeric;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'planned_stop_loss'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN planned_stop_loss numeric;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'planned_take_profit'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN planned_take_profit numeric;
  END IF;
END $$;

COMMENT ON COLUMN goal_session_trades.planned_entry_price IS 'Alpha original planned entry price (before market fill adjustment)';
COMMENT ON COLUMN goal_session_trades.planned_stop_loss IS 'Alpha original planned stop loss (before geometry preservation recalculation)';
COMMENT ON COLUMN goal_session_trades.planned_take_profit IS 'Alpha original planned take profit (before geometry preservation recalculation)';
