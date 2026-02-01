/*
  # Initialize Price Staleness Tracking for All Symbols
  
  Purpose:
    - Seed polling_price_staleness table with all unique symbols from realtime_prices
    - Ensures freshness tracking starts for all trading symbols
    - Performs one-time population of staleness data
*/

DO $$
DECLARE
  v_symbol text;
BEGIN
  -- Insert staleness record for each unique symbol in realtime_prices
  INSERT INTO polling_price_staleness (symbol, last_update_at, staleness_minutes, is_critical)
  SELECT DISTINCT
    rp.symbol,
    MAX(rp.created_at),
    EXTRACT(EPOCH FROM (now() - MAX(rp.created_at))) / 60.0,
    EXTRACT(EPOCH FROM (now() - MAX(rp.created_at))) / 60.0 > 5
  FROM realtime_prices rp
  GROUP BY rp.symbol
  ON CONFLICT (symbol) DO UPDATE SET
    last_update_at = EXCLUDED.last_update_at,
    staleness_minutes = EXCLUDED.staleness_minutes,
    is_critical = EXCLUDED.is_critical,
    updated_at = now();

  RAISE NOTICE 'Price staleness table initialized with % symbols',
    (SELECT COUNT(DISTINCT symbol) FROM polling_price_staleness);
END $$;
