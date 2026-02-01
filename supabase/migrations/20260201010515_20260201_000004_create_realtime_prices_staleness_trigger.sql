/*
  # Create Trigger to Update Price Staleness on Price Changes
  
  Purpose:
    - Automatically update polling_price_staleness when realtime_prices changes
    - Keep freshness metrics synchronized with actual price updates
    - Enable mid-trade monitor to detect stale data in real-time
    
  Trigger Logic:
    - On INSERT or UPDATE to realtime_prices, update corresponding symbol's staleness
    - Set last_update_at to current timestamp
    - Calculate staleness as 0 (fresh update)
    - Reset critical flag since price was just updated
    - Increment consecutive_stale_readings only if we were stale before
*/

CREATE OR REPLACE FUNCTION update_price_staleness_on_change()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO polling_price_staleness (
    symbol,
    last_update_at,
    staleness_minutes,
    is_critical,
    consecutive_stale_readings
  )
  VALUES (
    NEW.symbol,
    now(),
    0,
    false,
    0
  )
  ON CONFLICT (symbol) DO UPDATE SET
    last_update_at = now(),
    staleness_minutes = 0,
    is_critical = false,
    consecutive_stale_readings = 0,
    updated_at = now();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_realtime_prices_staleness ON realtime_prices;

CREATE TRIGGER trg_realtime_prices_staleness
AFTER INSERT OR UPDATE ON realtime_prices
FOR EACH ROW
EXECUTE FUNCTION update_price_staleness_on_change();

-- Create periodic function to mark stale prices
CREATE OR REPLACE FUNCTION mark_stale_prices()
RETURNS TABLE (stale_symbols text[], stale_count integer, critical_count integer) AS $$
DECLARE
  v_stale_count integer;
  v_critical_count integer;
BEGIN
  UPDATE polling_price_staleness
  SET
    staleness_minutes = EXTRACT(EPOCH FROM (now() - last_update_at)) / 60.0,
    is_critical = EXTRACT(EPOCH FROM (now() - last_update_at)) / 60.0 > 5,
    consecutive_stale_readings = CASE
      WHEN EXTRACT(EPOCH FROM (now() - last_update_at)) / 60.0 > 2
      THEN consecutive_stale_readings + 1
      ELSE 0
    END,
    updated_at = now()
  WHERE last_update_at IS NOT NULL;

  SELECT COUNT(*) INTO v_stale_count
  FROM polling_price_staleness
  WHERE staleness_minutes >= 2;

  SELECT COUNT(*) INTO v_critical_count
  FROM polling_price_staleness
  WHERE is_critical = true;

  RETURN QUERY SELECT
    ARRAY_AGG(symbol) FILTER (WHERE is_critical),
    v_stale_count,
    v_critical_count;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION mark_stale_prices() TO service_role;
GRANT EXECUTE ON FUNCTION update_price_staleness_on_change() TO service_role;
