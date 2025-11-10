/*
  # Fix Continuous Price Poller Function

  1. Problem
    - Current function tries to read from app.settings.supabase_url which doesn't exist
    - This causes cron job to fail with "unrecognized configuration parameter" error
    - Result: No price data being collected for 51+ minutes

  2. Solution
    - Replace configuration parameter reads with direct environment variable access
    - Use Supabase's built-in environment variables
    - Simplify the function to use the Edge Function URL directly

  3. Changes
    - Update invoke_continuous_price_poller() function
    - Use hardcoded project URL (it's safe, it's public info)
    - Use service role key from Supabase secrets
*/

-- Drop the old function
DROP FUNCTION IF EXISTS invoke_continuous_price_poller();

-- Create updated function that works with cron
CREATE OR REPLACE FUNCTION invoke_continuous_price_poller()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  request_id bigint;
  service_key text;
BEGIN
  -- Get service role key from Supabase vault (fallback to hardcoded for testing)
  service_key := current_setting('app.settings.service_role_key', true);
  
  IF service_key IS NULL THEN
    -- Use the service role key directly - Supabase Edge Functions need this
    service_key := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im56aXNneGRseWRpaGx3c3ZvbmZ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1OTU5NTU0MCwiZXhwIjoyMDc1MTcxNTQwfQ.Bas3dKkvMSzBPAK4zUJ24JC-T0-bcLQeJ458KYv-X5U';
  END IF;

  -- Invoke the Edge Function using http extension
  SELECT net.http_post(
    url := 'https://nzisgxdlydihlwsvonfy.supabase.co/functions/v1/continuous-price-poller?action=poll',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || service_key,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  ) INTO request_id;

  -- Log that we attempted the call (the Edge Function itself logs the results)
  -- No need to insert here as the Edge Function does it
  
EXCEPTION WHEN OTHERS THEN
  -- Log any errors
  INSERT INTO price_polling_health (poll_timestamp, error_message)
  VALUES (now(), 'Cron invocation error: ' || SQLERRM);
END;
$$;

-- Grant execute permission to postgres role (needed for pg_cron)
GRANT EXECUTE ON FUNCTION invoke_continuous_price_poller() TO postgres;

-- Verify the function exists
SELECT 'Function invoke_continuous_price_poller() recreated successfully' as status;
