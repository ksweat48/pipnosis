/*
  # Create is_forex_market_open() Helper Function

  1. New Functions
    - `is_forex_market_open()` - Returns boolean indicating if forex market is currently open
    - Checks weekends (Fri 5PM EST to Sun 5PM EST)
    - Checks US holidays (Memorial Day, Labor Day, etc.)

  2. Purpose
    - Used by cron jobs to skip execution during market closure
    - Reduces unnecessary DB load during weekends and holidays
    - Prevents autovacuum pressure from logging writes when market is closed
*/

CREATE OR REPLACE FUNCTION public.is_forex_market_open()
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  est_time timestamptz;
  est_dow integer;
  est_hour integer;
  est_month integer;
  est_day integer;
  est_year integer;
BEGIN
  est_time := now() AT TIME ZONE 'America/New_York';
  est_dow := EXTRACT(DOW FROM est_time)::integer;
  est_hour := EXTRACT(HOUR FROM est_time)::integer;
  est_month := EXTRACT(MONTH FROM est_time)::integer;
  est_day := EXTRACT(DAY FROM est_time)::integer;
  est_year := EXTRACT(YEAR FROM est_time)::integer;

  -- Weekend: Saturday always closed
  IF est_dow = 6 THEN RETURN false; END IF;
  -- Sunday before 5PM: closed
  IF est_dow = 0 AND est_hour < 17 THEN RETURN false; END IF;
  -- Friday after 5PM: closed
  IF est_dow = 5 AND est_hour >= 17 THEN RETURN false; END IF;

  -- Christmas
  IF est_month = 12 AND est_day = 25 THEN RETURN false; END IF;
  -- New Year
  IF est_month = 1 AND est_day = 1 THEN RETURN false; END IF;
  -- Independence Day
  IF est_month = 7 AND est_day = 4 THEN RETURN false; END IF;
  -- Memorial Day: last Monday of May
  IF est_month = 5 AND est_dow = 1 AND est_day > 24 THEN RETURN false; END IF;
  -- Labor Day: first Monday of September
  IF est_month = 9 AND est_dow = 1 AND est_day <= 7 THEN RETURN false; END IF;
  -- Thanksgiving: fourth Thursday of November
  IF est_month = 11 AND est_dow = 4 AND est_day >= 22 AND est_day <= 28 THEN RETURN false; END IF;
  -- MLK Day: third Monday of January
  IF est_month = 1 AND est_dow = 1 AND est_day >= 15 AND est_day <= 21 THEN RETURN false; END IF;
  -- Presidents Day: third Monday of February
  IF est_month = 2 AND est_dow = 1 AND est_day >= 15 AND est_day <= 21 THEN RETURN false; END IF;
  -- Good Friday (2024-2030)
  IF est_year = 2024 AND est_month = 3 AND est_day = 29 THEN RETURN false; END IF;
  IF est_year = 2025 AND est_month = 4 AND est_day = 18 THEN RETURN false; END IF;
  IF est_year = 2026 AND est_month = 4 AND est_day = 3 THEN RETURN false; END IF;
  IF est_year = 2027 AND est_month = 3 AND est_day = 26 THEN RETURN false; END IF;
  IF est_year = 2028 AND est_month = 4 AND est_day = 14 THEN RETURN false; END IF;
  IF est_year = 2029 AND est_month = 3 AND est_day = 30 THEN RETURN false; END IF;
  IF est_year = 2030 AND est_month = 4 AND est_day = 18 THEN RETURN false; END IF;

  RETURN true;
END;
$$;
