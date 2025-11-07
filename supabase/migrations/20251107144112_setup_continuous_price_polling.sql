/*
  # Setup Continuous Price Polling System

  1. Purpose
    - Enable server-side continuous price collection from MetaAPI
    - Ensure candle data is collected even when browser is closed
    - Schedule the continuous-price-poller Edge Function to run every 3 seconds

  2. Changes
    - Create pg_cron job to invoke continuous-price-poller Edge Function
    - Set up monitoring table for tracking polling health
    - Add indexes for performance optimization on realtime_prices table

  3. Security
    - Job runs with service role privileges
    - All existing RLS policies remain in effect
*/

-- Create a monitoring table to track price polling health
CREATE TABLE IF NOT EXISTS price_polling_health (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_timestamp timestamptz DEFAULT now(),
  successful_pairs integer DEFAULT 0,
  failed_pairs integer DEFAULT 0,
  total_duration_ms integer DEFAULT 0,
  error_message text,
  created_at timestamptz DEFAULT now()
);

-- Add index for quick lookups of recent health checks
CREATE INDEX IF NOT EXISTS idx_price_polling_health_created 
  ON price_polling_health(created_at DESC);

-- Add indexes to realtime_prices for better query performance
CREATE INDEX IF NOT EXISTS idx_realtime_prices_symbol_created 
  ON realtime_prices(symbol, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_realtime_prices_created 
  ON realtime_prices(created_at DESC);

-- Enable RLS on price_polling_health
ALTER TABLE price_polling_health ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read polling health
CREATE POLICY "Authenticated users can read polling health"
  ON price_polling_health
  FOR SELECT
  TO authenticated
  USING (true);

-- Only service role can insert health records (done by the cron job)
CREATE POLICY "Service role can insert health records"
  ON price_polling_health
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Create a function to invoke the continuous-price-poller Edge Function
CREATE OR REPLACE FUNCTION invoke_continuous_price_poller()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  request_id bigint;
  response jsonb;
BEGIN
  -- Invoke the Edge Function using http extension
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/continuous-price-poller?action=poll',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.supabase_service_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  ) INTO request_id;

  -- Log success (we don't wait for response in cron job to avoid blocking)
  INSERT INTO price_polling_health (poll_timestamp, successful_pairs, total_duration_ms)
  VALUES (now(), 0, 0);
  
EXCEPTION WHEN OTHERS THEN
  -- Log any errors
  INSERT INTO price_polling_health (poll_timestamp, error_message)
  VALUES (now(), SQLERRM);
END;
$$;

-- Grant execute permission to postgres role (needed for pg_cron)
GRANT EXECUTE ON FUNCTION invoke_continuous_price_poller() TO postgres;

-- Schedule the price polling job to run every 3 seconds
-- Note: pg_cron uses cron syntax where */3 means every 3 seconds is not directly supported
-- We'll use every second and let the function handle throttling, or use a minute-based schedule
SELECT cron.schedule(
  'continuous-price-polling',           -- job name
  '*/1 * * * *',                         -- every minute (we'll improve this with multiple calls)
  'SELECT invoke_continuous_price_poller();'
);

-- Create a function to call the poller multiple times per minute
CREATE OR REPLACE FUNCTION invoke_price_poller_multiple_times()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Call the poller 20 times with 3-second intervals (20 * 3s = 60s)
  FOR i IN 1..20 LOOP
    PERFORM invoke_continuous_price_poller();
    PERFORM pg_sleep(3);
  END LOOP;
END;
$$;

-- Update the cron job to use the multiple-call function
SELECT cron.unschedule('continuous-price-polling');

SELECT cron.schedule(
  'continuous-price-polling',
  '* * * * *',  -- Every minute
  'SELECT invoke_price_poller_multiple_times();'
);

-- Create a cleanup job to remove old health records (keep last 24 hours only)
CREATE OR REPLACE FUNCTION cleanup_old_polling_health()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM price_polling_health
  WHERE created_at < now() - interval '24 hours';
END;
$$;

SELECT cron.schedule(
  'cleanup-polling-health',
  '0 * * * *',  -- Every hour
  'SELECT cleanup_old_polling_health();'
);

-- Create a view for easy monitoring of polling health
CREATE OR REPLACE VIEW v_polling_health_summary AS
SELECT 
  date_trunc('minute', created_at) as minute,
  COUNT(*) as poll_count,
  AVG(successful_pairs) as avg_successful_pairs,
  AVG(failed_pairs) as avg_failed_pairs,
  AVG(total_duration_ms) as avg_duration_ms,
  COUNT(*) FILTER (WHERE error_message IS NOT NULL) as error_count
FROM price_polling_health
WHERE created_at > now() - interval '1 hour'
GROUP BY date_trunc('minute', created_at)
ORDER BY minute DESC;

-- Grant select on the view to authenticated users
GRANT SELECT ON v_polling_health_summary TO authenticated;
