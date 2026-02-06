/*
  # Create check_server_side_aggregation RPC

  1. New Functions
    - `check_server_side_aggregation()` - Returns the most recent netlify_aggregator candle
      to check if server-side candle aggregation is active

  2. Purpose
    - Bypasses PostgREST table introspection for forex_candles SELECT
    - Fixes 404 error when PostgREST schema cache doesn't include forex_candles

  3. Security
    - SECURITY DEFINER to bypass RLS
    - Granted to authenticated and anon roles
*/

CREATE OR REPLACE FUNCTION check_server_side_aggregation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result_row RECORD;
BEGIN
  SELECT open_time, data_source
  INTO result_row
  FROM forex_candles
  WHERE data_source = 'netlify_aggregator'
  ORDER BY open_time DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('open_time', NULL, 'data_source', NULL);
  END IF;

  RETURN jsonb_build_object(
    'open_time', result_row.open_time,
    'data_source', result_row.data_source
  );
END;
$$;

GRANT EXECUTE ON FUNCTION check_server_side_aggregation() TO authenticated;
GRANT EXECUTE ON FUNCTION check_server_side_aggregation() TO anon;
