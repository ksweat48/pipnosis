/*
  # FIX CRITICAL: Enable Realtime Events for realtime_prices Table

  ## Problem
  - Supabase Realtime subscription shows "SUBSCRIBED" status
  - BUT no INSERT events are being broadcast to clients
  - Frontend is stuck using fallback polling instead of real-time updates

  ## Root Cause
  - The `realtime_prices` table is missing `REPLICA IDENTITY FULL`
  - Without this, PostgreSQL Change Data Capture (CDC) cannot broadcast INSERT events
  - Supabase Realtime requires REPLICA IDENTITY FULL to stream changes

  ## Solution
  1. Add REPLICA IDENTITY FULL to realtime_prices table
  2. Verify table is in supabase_realtime publication
  3. This will immediately enable real-time INSERT event broadcasting

  ## Expected Result
  - Frontend will receive INSERT events in real-time
  - No more fallback polling needed
  - Chart updates instantly as prices come in from MetaAPI
*/

-- CRITICAL FIX: Add REPLICA IDENTITY FULL to enable CDC events
ALTER TABLE realtime_prices REPLICA IDENTITY FULL;

-- Verify the table is in the realtime publication (idempotent)
DO $$
BEGIN
  -- Check if table is already in publication
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND schemaname = 'public' 
    AND tablename = 'realtime_prices'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE realtime_prices;
  END IF;
END $$;

-- Create a diagnostic view to monitor realtime events
CREATE OR REPLACE VIEW v_realtime_diagnostic AS
SELECT 
  schemaname,
  tablename,
  CASE 
    WHEN schemaname || '.' || tablename IN (
      SELECT schemaname || '.' || tablename 
      FROM pg_publication_tables 
      WHERE pubname = 'supabase_realtime'
    ) THEN 'Published ✅'
    ELSE 'Not Published ❌'
  END as publication_status,
  (
    SELECT relreplident::text 
    FROM pg_class c 
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = schemaname 
    AND c.relname = tablename
  ) as replica_identity
FROM pg_tables
WHERE schemaname = 'public' 
  AND tablename IN ('realtime_prices', 'forex_candles', 'trade_history')
ORDER BY tablename;

GRANT SELECT ON v_realtime_diagnostic TO authenticated;

-- Log success
DO $$
BEGIN
  RAISE NOTICE '✅ REPLICA IDENTITY FULL added to realtime_prices';
  RAISE NOTICE '✅ Table verified in supabase_realtime publication';
  RAISE NOTICE '🎉 Realtime INSERT events should now broadcast correctly!';
END $$;