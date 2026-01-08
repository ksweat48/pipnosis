/*
  # Remove Swing Trades - Enforce Intraday-Only Trading

  CRITICAL FIX: Pipnosis is an INTRADAY-ONLY platform. NO SWING TRADES.

  1. Changes to goal_sessions.trade_style
    - Remove 'swing' from allowed values
    - Remove 'day' (renamed to 'intraday')
    - Add 'micro' (medium duration intraday)
    - Add 'intraday' (longer duration intraday)
    - Final values: 'scalper', 'micro', 'intraday'

  2. Trade Style Definitions
    - scalper: Fast trades, 20min-2hr duration
    - micro: Medium trades, 1hr-6hr duration
    - intraday: Longer intraday, 2hr-10hr duration

  3. Data Migration
    - Convert existing 'day' → 'intraday'
    - Convert existing 'swing' → 'intraday' (closest intraday equivalent)
    - Preserve 'scalper' as-is

  4. Safety
    - All trades MUST close before market close
    - Maximum duration: 10 hours (600 minutes)
    - NO multi-day positions allowed
*/

-- Step 1: Migrate existing data
-- Convert 'day' to 'intraday' and 'swing' to 'intraday'
UPDATE goal_sessions
SET trade_style = 'intraday'
WHERE trade_style IN ('day', 'swing');

-- Step 2: Drop the old constraint
ALTER TABLE goal_sessions
DROP CONSTRAINT IF EXISTS goal_sessions_trade_style_check;

-- Step 3: Add new constraint with correct intraday-only values
ALTER TABLE goal_sessions
ADD CONSTRAINT goal_sessions_trade_style_check
CHECK (trade_style IN ('scalper', 'micro', 'intraday'));

-- Step 4: Update column comment
COMMENT ON COLUMN goal_sessions.trade_style IS 'INTRADAY-ONLY trading style: scalper (20min-2hr), micro (1hr-6hr), intraday (2hr-10hr). NO SWING TRADES.';

-- Step 5: Add validation function to prevent swing trades
CREATE OR REPLACE FUNCTION validate_intraday_only()
RETURNS TRIGGER AS $$
BEGIN
  -- Hard block any attempt to use 'swing' or 'day'
  IF NEW.trade_style IN ('swing', 'day') THEN
    RAISE EXCEPTION 'SWING TRADES NOT ALLOWED: Pipnosis is intraday-only. Use scalper, micro, or intraday instead.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 6: Add trigger to enforce intraday-only
DROP TRIGGER IF EXISTS enforce_intraday_only_trigger ON goal_sessions;
CREATE TRIGGER enforce_intraday_only_trigger
  BEFORE INSERT OR UPDATE ON goal_sessions
  FOR EACH ROW
  EXECUTE FUNCTION validate_intraday_only();