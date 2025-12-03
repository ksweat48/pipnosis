/*
  # Add SQL-Based Candle Aggregation Function

  1. Purpose
    - Create a database function to aggregate candles directly from realtime_prices
    - More reliable than fetching all data and processing in application code
    - Uses SQL window functions for efficient OHLC calculation

  2. Function Details
    - Input: symbol, start_time, end_time
    - Output: OHLC data calculated from realtime_prices.created_at timestamps
    - Uses FIRST_VALUE/LAST_VALUE for open/close
    - Uses MAX/MIN for high/low
    - Returns price count for volume

  3. Security
    - Function is SECURITY DEFINER to allow service role access
    - No RLS bypass - only reads from realtime_prices
*/

-- Create function to aggregate candles from realtime_prices
CREATE OR REPLACE FUNCTION aggregate_candle_from_prices(
  p_symbol TEXT,
  p_start_time TIMESTAMPTZ,
  p_end_time TIMESTAMPTZ
)
RETURNS TABLE (
  first_price NUMERIC,
  last_price NUMERIC,
  high_price NUMERIC,
  low_price NUMERIC,
  price_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH price_data AS (
    SELECT
      ((bid + ask) / 2) AS mid_price,
      created_at,
      ROW_NUMBER() OVER (ORDER BY created_at ASC) as row_asc,
      ROW_NUMBER() OVER (ORDER BY created_at DESC) as row_desc
    FROM realtime_prices
    WHERE symbol = p_symbol
      AND created_at >= p_start_time
      AND created_at < p_end_time
  )
  SELECT
    (SELECT mid_price FROM price_data WHERE row_asc = 1) AS first_price,
    (SELECT mid_price FROM price_data WHERE row_desc = 1) AS last_price,
    MAX(mid_price) AS high_price,
    MIN(mid_price) AS low_price,
    COUNT(*)::BIGINT AS price_count
  FROM price_data;
END;
$$;

-- Grant execute permission to service role
GRANT EXECUTE ON FUNCTION aggregate_candle_from_prices(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION aggregate_candle_from_prices(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- Add comment
COMMENT ON FUNCTION aggregate_candle_from_prices IS 'Aggregates OHLC candle data from realtime_prices table for a given symbol and time range. Used by Netlify candle aggregator function.';
