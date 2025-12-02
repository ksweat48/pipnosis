/*
  # Fix XAUUSD (Gold) Price Range Validation

  ## Problem
  Gold prices have risen above $4,200/oz but database validation only allows $1,800-$3,500.
  This causes all XAUUSD candles to be rejected with "Price outside valid range" errors.

  ## Current Gold Price
  - Live price: ~$4,224/oz (as of Dec 2, 2025)
  - Current validation range: $1,800 - $3,500 ❌ TOO LOW

  ## Changes
  - Update XAUUSD price range from $1,800-$3,500 to $1,800-$6,000
  - This allows current prices and future growth
  - Still protects against wildly incorrect data

  ## Impact
  - Allows gold candles to be stored successfully
  - Fixes continuous-candle-aggregator errors for XAUUSD
  - Other pairs (EURUSD, GBPUSD, USDJPY, US30) continue working normally

  ## Evidence from Logs
  ```
  ERROR [CandleAggregator] Database error for XAUUSD M1:
  Price outside valid range for XAUUSD at 2025-12-02 03:19:00+00
  ```

  ## Validation Ranges After This Fix
  - EURUSD: 0.90 - 1.40 ✅
  - GBPUSD: 1.00 - 1.60 ✅
  - USDJPY: 90 - 180 ✅
  - AUDUSD: 0.50 - 0.90 ✅
  - USDCAD: 1.15 - 1.60 ✅
  - XAUUSD: 1800 - 6000 ✅ FIXED
  - US30: 30000 - 50000 ✅
*/

-- Update the validate_candle_price_range function with correct XAUUSD range
CREATE OR REPLACE FUNCTION validate_candle_price_range(
  p_symbol text,
  p_open numeric,
  p_high numeric,
  p_low numeric,
  p_close numeric
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_min numeric;
  v_max numeric;
BEGIN
  -- Define price ranges for each symbol
  CASE p_symbol
    WHEN 'EURUSD' THEN v_min := 0.90; v_max := 1.40;
    WHEN 'GBPUSD' THEN v_min := 1.00; v_max := 1.60;
    WHEN 'USDJPY' THEN v_min := 90; v_max := 180;
    WHEN 'AUDUSD' THEN v_min := 0.50; v_max := 0.90;
    WHEN 'USDCAD' THEN v_min := 1.15; v_max := 1.60;
    WHEN 'XAUUSD' THEN v_min := 1800; v_max := 6000;  -- FIXED: Was 3500, now 6000
    WHEN 'US30' THEN v_min := 30000; v_max := 50000;
    ELSE RETURN true; -- Unknown symbol, skip validation
  END CASE;

  -- Validate all OHLC values are within range
  IF p_open < v_min OR p_open > v_max OR
     p_high < v_min OR p_high > v_max OR
     p_low < v_min OR p_low > v_max OR
     p_close < v_min OR p_close > v_max THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;