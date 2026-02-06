/*
  # Create RPC function to upsert forex candles

  1. Problem
    - PostgREST returns 404 for forex_candles table despite it existing
    - This is a persistent schema cache issue on the Supabase platform side
    - Direct table upserts via REST API fail with 404

  2. Solution
    - Create an RPC function that bypasses PostgREST table introspection
    - RPC calls go through /rest/v1/rpc/ which uses function-level routing
    - The function does the upsert via SQL directly

  3. New Functions
    - `upsert_forex_candle(candle_data jsonb)` - Upserts a single candle
    - `upsert_forex_candles_batch(candles jsonb)` - Upserts a batch of candles

  4. Security
    - SECURITY DEFINER to bypass RLS (candles are shared market data)
    - Accessible to authenticated and anon roles
*/

-- Single candle upsert RPC
CREATE OR REPLACE FUNCTION upsert_forex_candle(candle_data jsonb)
RETURNS jsonb AS $$
DECLARE
  result_id bigint;
BEGIN
  INSERT INTO forex_candles (symbol, timeframe, open_time, close_time, open, high, low, close, volume, data_source, tick_count)
  VALUES (
    candle_data->>'symbol',
    candle_data->>'timeframe',
    (candle_data->>'open_time')::timestamptz,
    (candle_data->>'close_time')::timestamptz,
    (candle_data->>'open')::numeric,
    (candle_data->>'high')::numeric,
    (candle_data->>'low')::numeric,
    (candle_data->>'close')::numeric,
    COALESCE((candle_data->>'volume')::numeric, 0),
    COALESCE(candle_data->>'data_source', 'browser_aggregated'),
    COALESCE((candle_data->>'tick_count')::integer, 0)
  )
  ON CONFLICT (symbol, timeframe, open_time)
  DO UPDATE SET
    high = GREATEST(forex_candles.high, EXCLUDED.high),
    low = LEAST(forex_candles.low, EXCLUDED.low),
    close = EXCLUDED.close,
    volume = EXCLUDED.volume,
    tick_count = GREATEST(forex_candles.tick_count, EXCLUDED.tick_count)
  RETURNING id INTO result_id;

  RETURN jsonb_build_object('success', true, 'id', result_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Batch candle upsert RPC
CREATE OR REPLACE FUNCTION upsert_forex_candles_batch(candles jsonb)
RETURNS jsonb AS $$
DECLARE
  candle jsonb;
  inserted_count integer := 0;
  error_count integer := 0;
BEGIN
  FOR candle IN SELECT * FROM jsonb_array_elements(candles)
  LOOP
    BEGIN
      INSERT INTO forex_candles (symbol, timeframe, open_time, close_time, open, high, low, close, volume, data_source, tick_count)
      VALUES (
        candle->>'symbol',
        candle->>'timeframe',
        (candle->>'open_time')::timestamptz,
        (candle->>'close_time')::timestamptz,
        (candle->>'open')::numeric,
        (candle->>'high')::numeric,
        (candle->>'low')::numeric,
        (candle->>'close')::numeric,
        COALESCE((candle->>'volume')::numeric, 0),
        COALESCE(candle->>'data_source', 'browser_aggregated'),
        COALESCE((candle->>'tick_count')::integer, 0)
      )
      ON CONFLICT (symbol, timeframe, open_time)
      DO UPDATE SET
        high = GREATEST(forex_candles.high, EXCLUDED.high),
        low = LEAST(forex_candles.low, EXCLUDED.low),
        close = EXCLUDED.close,
        volume = EXCLUDED.volume,
        tick_count = GREATEST(forex_candles.tick_count, EXCLUDED.tick_count);

      inserted_count := inserted_count + 1;
    EXCEPTION WHEN OTHERS THEN
      error_count := error_count + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'inserted', inserted_count,
    'errors', error_count
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant access
GRANT EXECUTE ON FUNCTION upsert_forex_candle(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION upsert_forex_candle(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION upsert_forex_candles_batch(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION upsert_forex_candles_batch(jsonb) TO anon;
