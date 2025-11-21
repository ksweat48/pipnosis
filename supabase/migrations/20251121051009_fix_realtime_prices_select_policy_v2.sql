/*
  # Fix Realtime Prices SELECT Policy

  1. Issue
    - realtime_prices table exists and data is being inserted by edge functions
    - However, users cannot read the data due to missing or incorrect SELECT policy
    - This breaks the entire polling, charts, and candles system in the browser

  2. Changes
    - Ensure proper SELECT policy exists for all users
    - Verify service role has full access
    - Enable realtime for live updates

  3. Security
    - All users can read price data (public market data)
    - Authenticated users can insert (for browser-based polling)
    - Service role has full access
*/

-- Drop and recreate the SELECT policy to ensure it exists
DROP POLICY IF EXISTS "Anyone can read realtime prices" ON realtime_prices;

CREATE POLICY "Anyone can read realtime prices"
  ON realtime_prices
  FOR SELECT
  USING (true);

-- Verify RLS is enabled
ALTER TABLE realtime_prices ENABLE ROW LEVEL SECURITY;

-- Verify realtime is enabled for live updates
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND schemaname = 'public'
    AND tablename = 'realtime_prices'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE realtime_prices;
  END IF;
END $$;
