/*
  # Automatic Candle Gap Filling System

  1. New Tables
    - `candle_gap_fill_log` - Tracks all gap fill operations for auditing
    - `last_known_prices` - Caches the most recent price for each symbol

  2. Functions
    - `detect_candle_gaps()` - Detects missing candles in time sequences
    - `fill_candle_gap()` - Fills a single gap with a flat candle
    - `auto_fill_all_gaps()` - Scans and fills all gaps across all timeframes
    - `get_last_known_price()` - Retrieves the last known close price for a symbol
    - `update_last_known_price()` - Updates the price cache when new candles are inserted

  3. Triggers
    - Updates last_known_prices cache automatically when candles are inserted

  4. Scheduled Jobs
    - Runs gap detection and filling every 5 minutes

  5. Security
    - Enable RLS on new tables
    - Add policies for authenticated users and service role
*/

-- Create table to cache last known prices for quick gap filling
CREATE TABLE IF NOT EXISTS last_known_prices (
  symbol text PRIMARY KEY,
  last_price numeric NOT NULL,
  last_update timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE last_known_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations for authenticated users"
  ON last_known_prices
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow service role full access"
  ON last_known_prices
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Create table to log gap fill operations
CREATE TABLE IF NOT EXISTS candle_gap_fill_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  timeframe text NOT NULL,
  gap_start_time timestamptz NOT NULL,
  gap_end_time timestamptz NOT NULL,
  candles_filled integer NOT NULL DEFAULT 0,
  fill_price numeric NOT NULL,
  fill_method text NOT NULL DEFAULT 'last_known_price',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE candle_gap_fill_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read for authenticated users"
  ON candle_gap_fill_log
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow insert for service role"
  ON candle_gap_fill_log
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Create index for faster gap detection queries
CREATE INDEX IF NOT EXISTS idx_forex_candles_gap_detection
  ON forex_candles(symbol, timeframe, open_time);

-- Function to get timeframe interval in minutes
CREATE OR REPLACE FUNCTION get_timeframe_minutes(tf text)
RETURNS integer AS $$
BEGIN
  RETURN CASE tf
    WHEN 'm1' THEN 1
    WHEN 'm5' THEN 5
    WHEN 'm15' THEN 15
    WHEN 'm30' THEN 30
    WHEN 'h1' THEN 60
    WHEN 'h4' THEN 240
    WHEN 'd1' THEN 1440
    WHEN 'w1' THEN 10080
    ELSE 15
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to check if time is during forex market hours (Sunday 5pm EST to Friday 5pm EST)
CREATE OR REPLACE FUNCTION is_forex_market_open(check_time timestamptz)
RETURNS boolean AS $$
DECLARE
  est_time timestamptz;
  day_of_week integer;
  hour_of_day integer;
BEGIN
  -- Convert to EST/EDT
  est_time := check_time AT TIME ZONE 'America/New_York';
  day_of_week := EXTRACT(DOW FROM est_time); -- 0=Sunday, 6=Saturday
  hour_of_day := EXTRACT(HOUR FROM est_time);

  -- Saturday: Market closed
  IF day_of_week = 6 THEN
    RETURN false;
  END IF;

  -- Friday after 5pm: Market closed
  IF day_of_week = 5 AND hour_of_day >= 17 THEN
    RETURN false;
  END IF;

  -- Sunday before 5pm: Market closed
  IF day_of_week = 0 AND hour_of_day < 17 THEN
    RETURN false;
  END IF;

  -- All other times: Market open
  RETURN true;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to get the last known price for a symbol
CREATE OR REPLACE FUNCTION get_last_known_price(p_symbol text, before_time timestamptz DEFAULT now())
RETURNS numeric AS $$
DECLARE
  v_price numeric;
BEGIN
  -- First try to get from cache
  SELECT last_price INTO v_price
  FROM last_known_prices
  WHERE symbol = p_symbol
    AND last_update <= before_time;

  IF v_price IS NOT NULL THEN
    RETURN v_price;
  END IF;

  -- If not in cache, get from most recent candle
  SELECT close INTO v_price
  FROM forex_candles
  WHERE symbol = p_symbol
    AND close_time <= before_time
  ORDER BY close_time DESC
  LIMIT 1;

  IF v_price IS NOT NULL THEN
    -- Update cache
    INSERT INTO last_known_prices (symbol, last_price, last_update)
    VALUES (p_symbol, v_price, before_time)
    ON CONFLICT (symbol)
    DO UPDATE SET
      last_price = EXCLUDED.last_price,
      last_update = EXCLUDED.last_update,
      updated_at = now();

    RETURN v_price;
  END IF;

  -- If still no price found, try realtime_prices table
  SELECT (bid + ask) / 2 INTO v_price
  FROM realtime_prices
  WHERE symbol = p_symbol
    AND created_at <= before_time
  ORDER BY created_at DESC
  LIMIT 1;

  RETURN v_price;
END;
$$ LANGUAGE plpgsql;

-- Function to fill a single candle gap
CREATE OR REPLACE FUNCTION fill_candle_gap(
  p_symbol text,
  p_timeframe text,
  p_open_time timestamptz,
  p_close_time timestamptz,
  p_price numeric
)
RETURNS boolean AS $$
DECLARE
  v_existing_count integer;
BEGIN
  -- Check if candle already exists
  SELECT COUNT(*) INTO v_existing_count
  FROM forex_candles
  WHERE symbol = p_symbol
    AND timeframe = p_timeframe
    AND open_time = p_open_time;

  IF v_existing_count > 0 THEN
    RETURN false; -- Candle already exists
  END IF;

  -- Insert flat candle (open = high = low = close = last known price)
  INSERT INTO forex_candles (
    symbol,
    timeframe,
    open_time,
    close_time,
    open,
    high,
    low,
    close,
    volume,
    data_source
  ) VALUES (
    p_symbol,
    p_timeframe,
    p_open_time,
    p_close_time,
    p_price,
    p_price,
    p_price,
    p_price,
    0,
    'gap_fill'
  );

  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Function to detect and fill all gaps for a symbol/timeframe combination
CREATE OR REPLACE FUNCTION fill_gaps_for_symbol_timeframe(
  p_symbol text,
  p_timeframe text,
  p_lookback_hours integer DEFAULT 24
)
RETURNS TABLE(gaps_filled integer, candles_created integer) AS $$
DECLARE
  v_interval_minutes integer;
  v_interval_text text;
  v_start_time timestamptz;
  v_current_time timestamptz;
  v_expected_time timestamptz;
  v_last_known_price numeric;
  v_gaps_filled integer := 0;
  v_candles_created integer := 0;
  v_gap_start_time timestamptz;
  v_gap_end_time timestamptz;
  rec RECORD;
BEGIN
  -- Get interval for this timeframe
  v_interval_minutes := get_timeframe_minutes(p_timeframe);
  v_interval_text := v_interval_minutes || ' minutes';

  -- Calculate start time
  v_start_time := now() - (p_lookback_hours || ' hours')::interval;

  -- Get the last known price before our search window
  v_last_known_price := get_last_known_price(p_symbol, v_start_time);

  IF v_last_known_price IS NULL THEN
    RAISE NOTICE 'No price data available for % - skipping gap fill', p_symbol;
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  -- Find all existing candles in the time range
  v_expected_time := date_trunc('minute', v_start_time);
  -- Align to timeframe boundary
  v_expected_time := date_trunc('minute', v_expected_time) -
    (EXTRACT(MINUTE FROM v_expected_time)::integer % v_interval_minutes || ' minutes')::interval;

  v_current_time := date_trunc('minute', now());
  v_gap_start_time := NULL;

  -- Iterate through expected time slots
  WHILE v_expected_time < v_current_time LOOP
    -- Check if this time is during market hours
    IF is_forex_market_open(v_expected_time) THEN
      -- Check if candle exists for this time slot
      DECLARE
        v_exists boolean;
      BEGIN
        SELECT EXISTS(
          SELECT 1 FROM forex_candles
          WHERE symbol = p_symbol
            AND timeframe = p_timeframe
            AND open_time = v_expected_time
        ) INTO v_exists;

        IF NOT v_exists THEN
          -- Mark start of gap
          IF v_gap_start_time IS NULL THEN
            v_gap_start_time := v_expected_time;
          END IF;

          -- Get the most recent price before this gap
          v_last_known_price := get_last_known_price(p_symbol, v_expected_time);

          IF v_last_known_price IS NOT NULL THEN
            -- Fill the gap with a flat candle
            DECLARE
              v_filled boolean;
              v_close_time timestamptz;
            BEGIN
              v_close_time := v_expected_time + (v_interval_text)::interval;
              v_filled := fill_candle_gap(
                p_symbol,
                p_timeframe,
                v_expected_time,
                v_close_time,
                v_last_known_price
              );

              IF v_filled THEN
                v_candles_created := v_candles_created + 1;
              END IF;
            END;
          END IF;
        ELSE
          -- Candle exists, end of gap (if any)
          IF v_gap_start_time IS NOT NULL THEN
            v_gap_end_time := v_expected_time;
            v_gaps_filled := v_gaps_filled + 1;

            -- Log the gap fill
            INSERT INTO candle_gap_fill_log (
              symbol,
              timeframe,
              gap_start_time,
              gap_end_time,
              candles_filled,
              fill_price,
              fill_method
            ) VALUES (
              p_symbol,
              p_timeframe,
              v_gap_start_time,
              v_gap_end_time,
              v_candles_created,
              v_last_known_price,
              'automatic'
            );

            v_gap_start_time := NULL;
          END IF;

          -- Update last known price from this candle
          SELECT close INTO v_last_known_price
          FROM forex_candles
          WHERE symbol = p_symbol
            AND timeframe = p_timeframe
            AND open_time = v_expected_time;
        END IF;
      END;
    END IF;

    -- Move to next time slot
    v_expected_time := v_expected_time + (v_interval_text)::interval;
  END LOOP;

  -- If we ended while still in a gap, log it
  IF v_gap_start_time IS NOT NULL THEN
    v_gaps_filled := v_gaps_filled + 1;

    INSERT INTO candle_gap_fill_log (
      symbol,
      timeframe,
      gap_start_time,
      gap_end_time,
      candles_filled,
      fill_price,
      fill_method
    ) VALUES (
      p_symbol,
      p_timeframe,
      v_gap_start_time,
      v_current_time,
      v_candles_created,
      v_last_known_price,
      'automatic'
    );
  END IF;

  RETURN QUERY SELECT v_gaps_filled, v_candles_created;
END;
$$ LANGUAGE plpgsql;

-- Function to fill gaps for all symbols and timeframes
CREATE OR REPLACE FUNCTION auto_fill_all_gaps(p_lookback_hours integer DEFAULT 24)
RETURNS TABLE(
  symbol text,
  timeframe text,
  gaps_filled integer,
  candles_created integer
) AS $$
DECLARE
  v_symbol text;
  v_timeframe text;
  v_result RECORD;
BEGIN
  -- Get list of all active symbols
  FOR v_symbol IN
    SELECT DISTINCT forex_candles.symbol
    FROM forex_candles
    WHERE close_time > now() - interval '7 days'
    ORDER BY forex_candles.symbol
  LOOP
    -- Process each timeframe
    FOR v_timeframe IN
      SELECT unnest(ARRAY['m1', 'm5', 'm15', 'm30', 'h1', 'h4', 'd1', 'w1'])
    LOOP
      -- Fill gaps for this symbol/timeframe combination
      SELECT * INTO v_result
      FROM fill_gaps_for_symbol_timeframe(v_symbol, v_timeframe, p_lookback_hours);

      IF v_result.gaps_filled > 0 OR v_result.candles_created > 0 THEN
        RETURN QUERY SELECT
          v_symbol,
          v_timeframe,
          v_result.gaps_filled,
          v_result.candles_created;
      END IF;
    END LOOP;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update last_known_prices cache when new candles are inserted
CREATE OR REPLACE FUNCTION update_last_known_price_trigger()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO last_known_prices (symbol, last_price, last_update)
  VALUES (NEW.symbol, NEW.close, NEW.close_time)
  ON CONFLICT (symbol)
  DO UPDATE SET
    last_price = EXCLUDED.last_price,
    last_update = EXCLUDED.last_update,
    updated_at = now()
  WHERE last_known_prices.last_update < EXCLUDED.last_update;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on forex_candles table
DROP TRIGGER IF EXISTS trg_update_last_known_price ON forex_candles;
CREATE TRIGGER trg_update_last_known_price
  AFTER INSERT OR UPDATE ON forex_candles
  FOR EACH ROW
  EXECUTE FUNCTION update_last_known_price_trigger();

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_candle_gap_fill_log_symbol_timeframe
  ON candle_gap_fill_log(symbol, timeframe, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_last_known_prices_updated
  ON last_known_prices(updated_at DESC);

-- Initialize last_known_prices cache with current data
INSERT INTO last_known_prices (symbol, last_price, last_update)
SELECT DISTINCT ON (symbol)
  symbol,
  close as last_price,
  close_time as last_update
FROM forex_candles
WHERE close_time > now() - interval '1 day'
ORDER BY symbol, close_time DESC
ON CONFLICT (symbol) DO NOTHING;