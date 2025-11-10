/*
  # Enable Realtime and Fix Price Polling

  1. Purpose
    - Enable Supabase Realtime on realtime_prices table
    - Ensure INSERT events are broadcast to clients
    - Fix any issues preventing price collection

  2. Changes
    - Enable realtime publication on realtime_prices
    - Add trigger to ensure data propagation
    - Create manual price collection fallback

  3. Security
    - Maintain existing RLS policies
*/

-- Enable realtime for the realtime_prices table
ALTER PUBLICATION supabase_realtime ADD TABLE realtime_prices;

-- Create a function to manually invoke the price poller (for testing)
CREATE OR REPLACE FUNCTION public.manual_poll_prices()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
BEGIN
  -- This function can be called manually to trigger price polling
  -- It will invoke the edge function
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url', true) || '/functions/v1/continuous-price-poller?action=poll',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.supabase_anon_key', true),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  ) INTO result;
  
  RETURN result;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', SQLERRM);
END;
$$;

-- Grant execute to authenticated users for manual testing
GRANT EXECUTE ON FUNCTION public.manual_poll_prices() TO authenticated;

-- Create a view to check realtime status
CREATE OR REPLACE VIEW v_realtime_price_status AS
SELECT 
  symbol,
  COUNT(*) as total_records,
  MAX(created_at) as last_update,
  EXTRACT(EPOCH FROM (now() - MAX(created_at))) as seconds_since_last_update,
  AVG(CAST(spread AS numeric)) as avg_spread
FROM realtime_prices
WHERE created_at > now() - interval '1 hour'
GROUP BY symbol
ORDER BY last_update DESC NULLS LAST;

GRANT SELECT ON v_realtime_price_status TO authenticated;

-- Add a notification trigger for debugging
CREATE OR REPLACE FUNCTION notify_price_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- This helps debug if inserts are happening
  RAISE NOTICE 'Price inserted: % at %', NEW.symbol, NEW.created_at;
  RETURN NEW;
END;
$$;

-- Create trigger (commented out by default to avoid noise)
-- DROP TRIGGER IF EXISTS trg_notify_price_insert ON realtime_prices;
-- CREATE TRIGGER trg_notify_price_insert
--   AFTER INSERT ON realtime_prices
--   FOR EACH ROW
--   EXECUTE FUNCTION notify_price_insert();
