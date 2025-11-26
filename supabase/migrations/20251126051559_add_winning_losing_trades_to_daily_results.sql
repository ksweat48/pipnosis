/*
  # Add Winning and Losing Trades Columns to Daily Session Results

  1. Changes
    - Add `winning_trades` column to `daily_session_results` table
    - Add `losing_trades` column to `daily_session_results` table

  2. Purpose
    - Allow calendar tooltips to display win/loss breakdown
    - Provide more detailed daily performance metrics
*/

-- Add winning_trades column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'daily_session_results' AND column_name = 'winning_trades'
  ) THEN
    ALTER TABLE daily_session_results ADD COLUMN winning_trades integer DEFAULT 0;
  END IF;
END $$;

-- Add losing_trades column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'daily_session_results' AND column_name = 'losing_trades'
  ) THEN
    ALTER TABLE daily_session_results ADD COLUMN losing_trades integer DEFAULT 0;
  END IF;
END $$;

-- Backfill winning_trades and losing_trades from synthetic_backtest_sessions
UPDATE daily_session_results dsr
SET
  winning_trades = COALESCE(sbs.winning_trades, 0),
  losing_trades = COALESCE(sbs.losing_trades, 0)
FROM synthetic_backtest_sessions sbs
WHERE dsr.session_name = sbs.session_name
  AND dsr.user_id = sbs.user_id
  AND (dsr.winning_trades IS NULL OR dsr.winning_trades = 0);