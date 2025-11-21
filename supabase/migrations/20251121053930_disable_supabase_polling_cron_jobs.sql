/*
  # Disable Supabase Edge Function Polling Cron Jobs
  
  1. Purpose
    - Disable all pg_cron jobs that invoke Supabase Edge Functions for price polling
    - Migrate polling to Netlify scheduled functions for better monitoring and cost efficiency
  
  2. Affected Cron Jobs
    - continuous-price-poller-every-minute
    - aggregate-candles-every-5-minutes
    - fill-gaps-every-5-minutes
  
  3. Notes
    - Netlify functions will handle all polling via netlify.toml scheduled functions
    - This reduces Supabase Edge Function invocations
    - Polling becomes centralized and easier to monitor
*/

-- Unschedule the continuous price poller if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'continuous-price-poller-every-minute'
  ) THEN
    PERFORM cron.unschedule('continuous-price-poller-every-minute');
    RAISE NOTICE 'Unscheduled: continuous-price-poller-every-minute';
  END IF;
END $$;

-- Unschedule the candle aggregator if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'aggregate-candles-every-5-minutes'
  ) THEN
    PERFORM cron.unschedule('aggregate-candles-every-5-minutes');
    RAISE NOTICE 'Unscheduled: aggregate-candles-every-5-minutes';
  END IF;
END $$;

-- Unschedule the gap filler if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'fill-gaps-every-5-minutes'
  ) THEN
    PERFORM cron.unschedule('fill-gaps-every-5-minutes');
    RAISE NOTICE 'Unscheduled: fill-gaps-every-5-minutes';
  END IF;
END $$;