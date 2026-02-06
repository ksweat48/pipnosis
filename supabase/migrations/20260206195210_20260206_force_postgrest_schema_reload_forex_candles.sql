/*
  # Force PostgREST Schema Reload for forex_candles

  1. Problem
    - forex_candles table exists and is accessible via SQL
    - PostgREST returns 404 when accessing via REST API
    - This is a stale schema cache issue
  
  2. Fix
    - Force PostgREST to reload its schema cache by sending NOTIFY
    - Add a comment update to ensure the schema is re-introspected
*/

-- Force PostgREST schema cache reload
NOTIFY pgrst, 'reload schema';

-- Touch the table comment to ensure schema re-introspection
COMMENT ON TABLE public.forex_candles IS 'Stores OHLCV candle data for all tradable instruments. Schema reload forced 2026-02-06.';
