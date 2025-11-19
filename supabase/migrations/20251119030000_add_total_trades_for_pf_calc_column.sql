/*
  # Add Total Trades Tracking for Profit Factor Calculation

  ## Changes
  1. Add `total_trades_for_pf_calc` column to `ai_skill_progression` table
     - Tracks total number of trades (wins + losses + breakeven) used in profit factor calculations
     - Ensures proper weighted averaging of profit factor across sessions
     - Default value is same as `total_trades_analyzed` for backwards compatibility

  ## Purpose
  Fix profit factor not updating correctly by tracking the actual trade volume that contributes
  to profit factor calculations, separate from just winning trades count.

  ## Security
  - No changes to RLS policies
  - Column is nullable for backwards compatibility
*/

-- Add column to track total trades for profit factor weighting
ALTER TABLE ai_skill_progression
ADD COLUMN IF NOT EXISTS total_trades_for_pf_calc integer DEFAULT 0;

-- Backfill existing records: set to total_trades_analyzed as initial value
UPDATE ai_skill_progression
SET total_trades_for_pf_calc = total_trades_analyzed
WHERE total_trades_for_pf_calc IS NULL OR total_trades_for_pf_calc = 0;

-- Add helpful comment
COMMENT ON COLUMN ai_skill_progression.total_trades_for_pf_calc IS
'Total number of ALL trades (wins+losses+breakeven) used for profit factor weighted averaging. Separate from total_trades_analyzed which only counts winning trades.';
