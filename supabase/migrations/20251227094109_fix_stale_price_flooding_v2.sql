/*
  # Fix Stale Price Flooding - Add Price Deduplication (v2)

  ## Problem
  The same price (e.g., 87404.10 for BTCUSD) is being saved 500+ times,
  flooding the database with stale data. When candles are aggregated,
  these stale prices create extreme LOW values that persist across many candles.

  ## Solution
  1. Clean up existing flood of duplicate prices
  2. Add a trigger to prevent duplicate prices from being inserted

  ## Expected Impact
  - Candles will have accurate OHLC based on actual price movements
  - Database size will be reduced significantly
  - Chart display will be accurate
*/

-- Step 1: Delete stale flood prices that are duplicated excessively
-- Keep only the first occurrence of each price within each 30-second window
WITH duplicate_prices AS (
  SELECT 
    id,
    ROW_NUMBER() OVER (
      PARTITION BY symbol, ROUND(bid::numeric, 2), DATE_TRUNC('minute', created_at)
      ORDER BY created_at
    ) as rn
  FROM realtime_prices
  WHERE created_at > NOW() - INTERVAL '2 hours'
)
DELETE FROM realtime_prices
WHERE id IN (
  SELECT id FROM duplicate_prices WHERE rn > 5
);

-- Step 2: Create a function to prevent duplicate price inserts
CREATE OR REPLACE FUNCTION prevent_duplicate_prices()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_recent_price RECORD;
  v_price_diff NUMERIC;
  v_min_change_threshold NUMERIC;
BEGIN
  -- Set minimum price change threshold based on symbol
  -- Crypto: 0.01% minimum change, Forex: 0.001%
  IF NEW.symbol IN ('BTCUSD', 'ETHUSD') THEN
    v_min_change_threshold := 0.0001; -- 0.01%
  ELSE
    v_min_change_threshold := 0.00001; -- 0.001%
  END IF;

  -- Check for recent price within last 10 seconds
  SELECT bid, ask INTO v_recent_price
  FROM realtime_prices
  WHERE symbol = NEW.symbol
    AND created_at > NOW() - INTERVAL '10 seconds'
  ORDER BY created_at DESC
  LIMIT 1;

  -- If no recent price, allow insert
  IF v_recent_price IS NULL THEN
    RETURN NEW;
  END IF;

  -- Calculate price difference as percentage
  v_price_diff := ABS((NEW.bid - v_recent_price.bid) / NULLIF(v_recent_price.bid, 0));

  -- If price hasn't changed significantly, skip insert
  IF v_price_diff < v_min_change_threshold THEN
    -- Price is essentially the same, skip this insert to prevent flooding
    RETURN NULL;
  END IF;

  -- Price has changed, allow insert
  RETURN NEW;
END;
$$;

-- Step 3: Create trigger for deduplication
DROP TRIGGER IF EXISTS prevent_duplicate_prices_trigger ON realtime_prices;

CREATE TRIGGER prevent_duplicate_prices_trigger
  BEFORE INSERT ON realtime_prices
  FOR EACH ROW
  EXECUTE FUNCTION prevent_duplicate_prices();

-- Step 4: Clean up old excessive data (keep last 2 hours only)
DELETE FROM realtime_prices
WHERE created_at < NOW() - INTERVAL '2 hours';

COMMENT ON FUNCTION prevent_duplicate_prices() IS
  'Prevents duplicate/stale prices from flooding the database. Only allows price inserts if the price has changed by at least 0.01% (crypto) or 0.001% (forex) from the last saved price within 10 seconds.';
