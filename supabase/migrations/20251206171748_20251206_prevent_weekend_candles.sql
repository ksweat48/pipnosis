/*
  # Prevent Weekend Candles - Database Protection Layer

  1. Problem
    - Netlify aggregator was creating fake candles during market closed hours (weekends)
    - 9,045 fake weekend candles were polluting the chart data
    - Charts showed green candles on Saturday/Sunday when market is actually closed

  2. Solution
    - Add CHECK constraint to forex_candles table
    - Reject ANY insert/update that tries to create weekend candles
    - Friday closes at 21:00 UTC (5pm EST), Sunday opens at 21:00 UTC (5pm EST)

  3. Protection Rules
    - BLOCK all Saturday candles (day of week = 6)
    - BLOCK Friday candles after 21:00 UTC
    - BLOCK Sunday candles before 21:00 UTC

  4. Changes
    - Add constraint: forex_candles_no_weekend_check
    - This is the LAST LINE OF DEFENSE against fake weekend data
*/

-- Add CHECK constraint to prevent weekend candles
-- This ensures NO code can ever insert weekend candles, even if it bypasses validation
ALTER TABLE forex_candles
ADD CONSTRAINT forex_candles_no_weekend_check
CHECK (
  -- Allow Monday-Thursday (all hours)
  EXTRACT(DOW FROM open_time) BETWEEN 1 AND 4
  OR
  -- Allow Friday before 21:00 UTC
  (EXTRACT(DOW FROM open_time) = 5 AND EXTRACT(HOUR FROM open_time) < 21)
  OR
  -- Allow Sunday after 21:00 UTC
  (EXTRACT(DOW FROM open_time) = 0 AND EXTRACT(HOUR FROM open_time) >= 21)
);

-- Log the constraint addition
COMMENT ON CONSTRAINT forex_candles_no_weekend_check ON forex_candles IS
'Prevents insertion of candles during Forex market closed hours (weekends). Market closes Friday 21:00 UTC and reopens Sunday 21:00 UTC.';
