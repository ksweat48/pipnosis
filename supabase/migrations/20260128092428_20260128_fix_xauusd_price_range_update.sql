/*
  # Update XAUUSD Price Validation Range

  ## Problem
  Gold (XAUUSD) has rallied to $5,281.82, exceeding the current validation range of 1000-5000.
  This causes legitimate prices to be rejected with "Invalid bid price" errors.

  ## Root Cause
  Previous migration set gold range too conservatively at 1000-5000.
  Gold can exceed $5,000 during strong bull markets.

  ## Solution
  Update XAUUSD price range to 1000-8000 to accommodate:
  - Current price levels ($5,281)
  - Potential continued rally
  - Historical precedent

  ## Changes
  - Update validate_price_range() function
  - Increase XAUUSD upper bound from 5000 to 8000
  - Maintains 1000 lower bound (protects against data errors)

  ## SSOT Compliance
  - Single source of truth for price validation
  - All validation goes through this function
  - No duplicate logic
*/

-- Update XAUUSD price range to accommodate current market levels
CREATE OR REPLACE FUNCTION validate_price_range(
  p_symbol text,
  p_price numeric
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Null prices are invalid
  IF p_price IS NULL OR p_symbol IS NULL THEN
    RETURN false;
  END IF;

  -- Negative or zero prices are always invalid
  IF p_price <= 0 THEN
    RETURN false;
  END IF;

  -- Validate by symbol (generous ranges to avoid false rejections)
  CASE p_symbol
    -- Crypto (most volatile, widest ranges)
    WHEN 'BTCUSD', 'BTC/USD' THEN
      RETURN p_price >= 1000 AND p_price <= 250000;
    WHEN 'ETHUSD', 'ETH/USD' THEN
      RETURN p_price >= 100 AND p_price <= 15000;

    -- Gold - UPDATED RANGE for current market levels
    WHEN 'XAUUSD', 'XAU/USD' THEN
      RETURN p_price >= 1000 AND p_price <= 8000;

    -- Forex Majors
    WHEN 'EURUSD', 'EUR/USD' THEN
      RETURN p_price >= 0.5 AND p_price <= 3.0;
    WHEN 'GBPUSD', 'GBP/USD' THEN
      RETURN p_price >= 0.5 AND p_price <= 3.0;
    WHEN 'USDJPY', 'USD/JPY' THEN
      RETURN p_price >= 50 AND p_price <= 200;

    -- Forex Exotics
    WHEN 'USDCAD', 'USD/CAD', 'AUDUSD', 'AUD/USD', 'NZDUSD', 'NZD/USD' THEN
      RETURN p_price >= 0.3 AND p_price <= 5.0;

    -- Indices
    WHEN 'NAS100', 'NAS' THEN
      RETURN p_price >= 5000 AND p_price <= 50000;
    WHEN 'US30', 'DJI' THEN
      RETURN p_price >= 15000 AND p_price <= 65000;
    WHEN 'SPX500', 'SPX', 'SP500' THEN
      RETURN p_price >= 1000 AND p_price <= 10000;

    -- Unknown symbol: accept all positive prices (defensive)
    ELSE
      RETURN p_price > 0;
  END CASE;
END;
$$;