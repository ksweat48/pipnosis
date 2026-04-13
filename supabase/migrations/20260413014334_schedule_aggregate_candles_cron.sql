
/*
  # Schedule aggregate-candles edge function via pg_cron

  ## Summary
  Schedules the aggregate-candles Supabase edge function to run every 2 minutes
  automatically. This ensures continuous candle building from realtime_prices ticks
  without requiring manual invocation or relying on the Netlify continuous-candle-aggregator
  (which has not yet been deployed via git with the broker clock skew fix).

  ## Why
  - The aggregate-candles edge function was rewritten with the broker clock skew fix
    (using broker_time as effectiveNow for forex symbols)
  - The Netlify continuous-candle-aggregator fix cannot be deployed without a git push
  - This cron ensures candles are built continuously at 2-minute intervals

  ## Notes
  - Uses net.http_post to invoke the edge function via HTTP
  - Runs every 2 minutes to match the Netlify aggregator cadence
  - Service role key is used for authentication
*/

SELECT cron.schedule(
  'aggregate-candles-every-2-min',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT value FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/aggregate-candles',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $$
);
