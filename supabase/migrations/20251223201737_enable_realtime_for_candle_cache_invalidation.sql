/*
  # Enable Realtime for Candle Cache Invalidation Events
  
  ## Problem
  The `candle_cache_invalidation_events` table exists but realtime subscriptions are failing with CHANNEL_ERROR.
  This is because the table is not added to the realtime publication.
  
  ## Changes
  1. Enable realtime subscriptions for the `candle_cache_invalidation_events` table
  2. Add SELECT policy for authenticated users to allow them to subscribe
  
  ## Security
  - Authenticated users can read cache invalidation events (read-only)
  - This allows clients to react to cache invalidation in real-time
*/

-- Enable realtime for the table
ALTER PUBLICATION supabase_realtime ADD TABLE candle_cache_invalidation_events;

-- Check if there are any existing policies, if not, add a permissive read policy
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'candle_cache_invalidation_events' 
    AND policyname = 'Allow authenticated users to read cache invalidation events'
  ) THEN
    CREATE POLICY "Allow authenticated users to read cache invalidation events"
      ON candle_cache_invalidation_events
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;
