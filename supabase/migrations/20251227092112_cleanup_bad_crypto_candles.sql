/*
  # Cleanup Bad Candles - Remove Invalid OHLC Data

  1. Purpose
    - Remove candles with invalid OHLC relationships
    - Remove candles with extreme ranges (> 5% of price)
    - Fix data quality issues causing chart display problems

  2. What Gets Removed
    - Candles where high < low (invalid)
    - Candles where open or close outside [low, high] range
    - Candles with > 5% price range (indicates stale/bad data)
    - Crypto candles (BTC/ETH) with extreme volatility

  3. Safety
    - Targets only problematic candles
    - Preserves valid data
*/

-- Delete candles with invalid OHLC relationships
DELETE FROM forex_candles
WHERE symbol IN ('BTCUSD', 'ETHUSD')
  AND (
    high < low
    OR open < low OR open > high
    OR close < low OR close > high
  );

-- Delete candles with extreme price ranges (> 5%)
DELETE FROM forex_candles
WHERE symbol IN ('BTCUSD', 'ETHUSD')
  AND ((high - low) / NULLIF((open + close) / 2, 0) * 100) > 5;

-- Create validation function
CREATE OR REPLACE FUNCTION validate_candle_ohlc()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.high < NEW.low THEN
    RAISE EXCEPTION 'Invalid candle: high % < low %', NEW.high, NEW.low;
  END IF;

  IF NEW.open < NEW.low OR NEW.open > NEW.high THEN
    RAISE EXCEPTION 'Invalid candle: open % outside [%, %]', NEW.open, NEW.low, NEW.high;
  END IF;

  IF NEW.close < NEW.low OR NEW.close > NEW.high THEN
    RAISE EXCEPTION 'Invalid candle: close % outside [%, %]', NEW.close, NEW.low, NEW.high;
  END IF;

  -- Check for extreme range (> 5%) for crypto
  IF NEW.symbol IN ('BTCUSD', 'ETHUSD') THEN
    DECLARE
      range_percent NUMERIC;
    BEGIN
      range_percent := ((NEW.high - NEW.low) / NULLIF((NEW.open + NEW.close) / 2, 0)) * 100;
      IF range_percent > 5 THEN
        RAISE WARNING 'Rejecting % candle with extreme range: %.2f%%', NEW.symbol, range_percent;
        RETURN NULL;
      END IF;
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop and recreate trigger
DROP TRIGGER IF EXISTS validate_candle_ohlc_trigger ON forex_candles;

CREATE TRIGGER validate_candle_ohlc_trigger
  BEFORE INSERT OR UPDATE ON forex_candles
  FOR EACH ROW
  EXECUTE FUNCTION validate_candle_ohlc();

-- Add crypto index
CREATE INDEX IF NOT EXISTS idx_forex_candles_crypto_symbol_time
  ON forex_candles(symbol, timeframe, open_time DESC)
  WHERE symbol IN ('BTCUSD', 'ETHUSD');