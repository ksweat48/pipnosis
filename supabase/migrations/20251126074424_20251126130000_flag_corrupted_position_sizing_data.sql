/*
  # Flag Corrupted Backtest Data from Position Sizing Bug

  1. Problem
    - Position sizing calculation bug (fixed 2025-11-26) caused ALL trades to be 5-10x overleveraged
    - Every backtest result prior to fix is invalid
    - All P&L numbers, win rates, and AI learning metrics are corrupted

  2. Changes
    - Add flag column to synthetic_backtest_sessions indicating data validity
    - Mark all existing sessions as corrupted (pre-fix)
    - Add comment explaining the bug
    - Future sessions after fix will be marked as valid

  3. Impact
    - Historical backtests flagged as invalid
    - UI can filter out or warn about corrupted data
    - AI learning can be reset to ignore pre-fix data
*/

-- Add corruption flag to synthetic backtest sessions
ALTER TABLE synthetic_backtest_sessions
  ADD COLUMN IF NOT EXISTS is_corrupted_data boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS corruption_reason text,
  ADD COLUMN IF NOT EXISTS corruption_detected_at timestamptz;

-- Mark ALL existing sessions as corrupted
UPDATE synthetic_backtest_sessions
SET 
  is_corrupted_data = true,
  corruption_reason = 'Position Sizing Bug: Trades were 5-10x overleveraged. Fixed 2025-11-26. All results invalid.',
  corruption_detected_at = now()
WHERE is_corrupted_data IS NULL OR is_corrupted_data = false;

-- Add index for filtering
CREATE INDEX IF NOT EXISTS idx_synthetic_backtest_sessions_corrupted 
  ON synthetic_backtest_sessions(is_corrupted_data);

-- Add comments
COMMENT ON COLUMN synthetic_backtest_sessions.is_corrupted_data IS 
  'True if session data is known to be corrupted by bugs. Filter these out from analytics.';

COMMENT ON COLUMN synthetic_backtest_sessions.corruption_reason IS 
  'Explanation of why data is corrupted (e.g., "Position Sizing Bug")';

-- Also flag synthetic trades
ALTER TABLE synthetic_backtest_trades
  ADD COLUMN IF NOT EXISTS is_corrupted_data boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS corruption_reason text;

-- Mark all existing trades as corrupted
UPDATE synthetic_backtest_trades
SET 
  is_corrupted_data = true,
  corruption_reason = 'Position Sizing Bug: Position sizes were 5-10x too large. Fixed 2025-11-26.'
WHERE is_corrupted_data IS NULL OR is_corrupted_data = false;

CREATE INDEX IF NOT EXISTS idx_synthetic_backtest_trades_corrupted 
  ON synthetic_backtest_trades(is_corrupted_data);

-- Add helper view for valid (non-corrupted) sessions
CREATE OR REPLACE VIEW valid_backtest_sessions AS
SELECT *
FROM synthetic_backtest_sessions
WHERE is_corrupted_data = false;

COMMENT ON VIEW valid_backtest_sessions IS 
  'Only includes backtest sessions with valid (non-corrupted) data';

-- Log the migration
DO $$
BEGIN
  RAISE NOTICE '✅ Flagged all pre-2025-11-26 backtest data as corrupted';
  RAISE NOTICE '📊 Position sizing bug fix applied - future sessions will be valid';
  RAISE NOTICE '⚠️  AI learning metrics should be recalculated from clean data only';
END $$;
