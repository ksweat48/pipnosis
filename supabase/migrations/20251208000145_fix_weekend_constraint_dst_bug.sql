/*
  # Fix Weekend Candle Constraint - Daylight Saving Time Bug
  
  1. Problem
    - The forex_candles_no_weekend_check constraint uses hardcoded UTC times (21:00)
    - This works during EDT (daylight saving) when 5pm EST = 21:00 UTC
    - But FAILS during standard time when 5pm EST = 22:00 UTC
    - Market opened Sunday 5pm EST (22:00 UTC) but constraint blocks candles after 21:00 UTC
    
  2. Root Cause
    - Constraint doesn't account for EST/EDT timezone changes
    - December is standard time: 5pm EST = 22:00 UTC (not 21:00 UTC)
    - This blocks all legitimate Sunday evening candles
    
  3. Solution
    - DROP the rigid UTC-based constraint
    - Rely on application-level validation which correctly handles America/New_York timezone
    - The candle aggregator already has proper DST-aware validation (isMarketOpenAtTime function)
    
  4. Safety
    - Application code in continuous-candle-aggregator.ts has isMarketOpenAtTime() check
    - This function uses America/New_York timezone which auto-handles DST
    - Line 356: if (!isMarketOpenAtTime(candle.open_time)) { skip candle }
    - This is more reliable than hardcoded UTC times
*/

-- Remove the problematic constraint
ALTER TABLE forex_candles
DROP CONSTRAINT IF EXISTS forex_candles_no_weekend_check;

-- Add comment explaining why we removed it
COMMENT ON TABLE forex_candles IS 
'Weekend candle validation is handled at application level using America/New_York timezone which correctly handles daylight saving time. Database constraint was too rigid and failed during EST/EDT transitions.';
