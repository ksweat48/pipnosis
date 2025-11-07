/*
  # Configure Monitoring Functions for Server-Side Candle System

  1. Purpose
    - Add monitoring and status check functions
    - Create views for easy health monitoring
    - Enable authenticated users to check system status

  2. Changes
    - Create price data freshness checker
    - Create candle completion status functions
    - Add helpful monitoring views

  3. Security
    - All functions are SECURITY DEFINER with proper permissions
    - Authenticated users can read status
*/

-- Add a monitoring function to check if price data is flowing
CREATE OR REPLACE FUNCTION check_price_data_freshness()
RETURNS TABLE(
  symbol text,
  last_price_time timestamptz,
  seconds_since_last_price numeric,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    symbols.symbol,
    MAX(rp.created_at) as last_price_time,
    EXTRACT(EPOCH FROM (now() - MAX(rp.created_at))) as seconds_since_last_price,
    CASE 
      WHEN MAX(rp.created_at) IS NULL THEN 'NO_DATA'
      WHEN EXTRACT(EPOCH FROM (now() - MAX(rp.created_at))) < 30 THEN 'ACTIVE'
      WHEN EXTRACT(EPOCH FROM (now() - MAX(rp.created_at))) < 300 THEN 'STALE'
      ELSE 'INACTIVE'
    END as status
  FROM (
    SELECT 'XAUUSD' as symbol UNION ALL
    SELECT 'US30' UNION ALL
    SELECT 'EURUSD' UNION ALL
    SELECT 'GBPUSD' UNION ALL
    SELECT 'USDJPY'
  ) symbols
  LEFT JOIN realtime_prices rp ON rp.symbol = symbols.symbol
    AND rp.created_at > now() - interval '10 minutes'
  GROUP BY symbols.symbol;
END;
$$;

GRANT EXECUTE ON FUNCTION check_price_data_freshness() TO authenticated;

-- Create a view for easy monitoring
CREATE OR REPLACE VIEW v_price_data_status AS
SELECT * FROM check_price_data_freshness();

GRANT SELECT ON v_price_data_status TO authenticated;

-- Create a function to get candle completion stats
CREATE OR REPLACE FUNCTION get_candle_stats()
RETURNS TABLE(
  timeframe text,
  incomplete_candles bigint,
  oldest_incomplete timestamptz,
  newest_incomplete timestamptz,
  total_ticks bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    cs.timeframe,
    COUNT(*) as incomplete_candles,
    MIN(cs.open_time) as oldest_incomplete,
    MAX(cs.open_time) as newest_incomplete,
    SUM(cs.tick_count) as total_ticks
  FROM candle_state cs
  WHERE cs.is_complete = false
  GROUP BY cs.timeframe
  ORDER BY cs.timeframe;
END;
$$;

GRANT EXECUTE ON FUNCTION get_candle_stats() TO authenticated;

CREATE OR REPLACE VIEW v_candle_completion_status AS
SELECT * FROM get_candle_stats();

GRANT SELECT ON v_candle_completion_status TO authenticated;

-- Create a comprehensive system health check function
CREATE OR REPLACE FUNCTION get_candle_system_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
  price_count integer;
  candle_count integer;
  last_price_time timestamptz;
  last_candle_time timestamptz;
BEGIN
  -- Check recent price data
  SELECT COUNT(*), MAX(created_at) INTO price_count, last_price_time
  FROM realtime_prices
  WHERE created_at > now() - interval '5 minutes';
  
  -- Check recent candle data
  SELECT COUNT(*), MAX(created_at) INTO candle_count, last_candle_time
  FROM forex_candles
  WHERE created_at > now() - interval '10 minutes';
  
  result := jsonb_build_object(
    'timestamp', now(),
    'price_data', jsonb_build_object(
      'recent_ticks', price_count,
      'last_tick_time', last_price_time,
      'seconds_since_last_tick', EXTRACT(EPOCH FROM (now() - COALESCE(last_price_time, now() - interval '1 hour')))
    ),
    'candle_data', jsonb_build_object(
      'recent_candles', candle_count,
      'last_candle_time', last_candle_time,
      'seconds_since_last_candle', EXTRACT(EPOCH FROM (now() - COALESCE(last_candle_time, now() - interval '1 hour')))
    ),
    'system_status', CASE
      WHEN price_count > 0 AND candle_count > 0 THEN 'healthy'
      WHEN price_count > 0 THEN 'degraded'
      ELSE 'unhealthy'
    END
  );
  
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_candle_system_health() TO authenticated;

-- Add comments for documentation
COMMENT ON FUNCTION check_price_data_freshness() IS 
  'Returns the status of price data for each trading pair, showing when the last price update was received';

COMMENT ON FUNCTION get_candle_stats() IS 
  'Returns statistics about incomplete candles being aggregated in real-time';

COMMENT ON FUNCTION get_candle_system_health() IS 
  'Returns overall health status of the candle collection and aggregation system';

COMMENT ON VIEW v_price_data_status IS 
  'Real-time view of price data freshness for all trading pairs';

COMMENT ON VIEW v_candle_completion_status IS 
  'Real-time view of candle aggregation progress by timeframe';
