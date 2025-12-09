/*
  # Extend realtime_prices retention to 24 hours

  1. Changes
    - Update cleanup function to keep 24 hours instead of 1 hour
    - Allows gap filler to backfill any gap within 24 hours
    - Matches gap filler time window

  2. Impact
    - Database size increases 24x for realtime_prices table
    - Better backfill coverage for recent gaps
    - All gaps < 24 hours become fillable
*/

-- Update cleanup function to keep 24 hours instead of 1 hour
CREATE OR REPLACE FUNCTION cleanup_old_realtime_prices()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM realtime_prices
  WHERE created_at < now() - interval '24 hours';
END;
$$;

-- Add comment
COMMENT ON FUNCTION cleanup_old_realtime_prices IS 'Cleans up realtime_prices older than 24 hours. Retention period matches gap filler time window.';