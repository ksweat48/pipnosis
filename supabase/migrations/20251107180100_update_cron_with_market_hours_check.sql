/*
  # Update Continuous Price Polling Cron Job with Market Hours Check

  1. Purpose
    - Update the existing cron job to check market hours before polling
    - Skip polling invocations when market is closed
    - Respect manual override configuration settings
    - Maintain existing 3-second polling interval when market is open

  2. Changes
    - Replace invoke_continuous_price_poller() function with market-aware version
    - Update invoke_price_poller_multiple_times() to respect market hours
    - Add logging for skipped polls due to market closure
    - Check maintenance mode and force polling overrides

  3. Behavior
    - Market Open: Polls every 3 seconds as before (20 times per minute)
    - Market Closed: Skips polling, logs status, saves resources
    - Force Polling: Continues polling regardless of market hours
    - Maintenance Mode: Stops all polling regardless of market hours
*/

-- Drop existing function to replace with market-aware version
DROP FUNCTION IF EXISTS invoke_continuous_price_poller();

-- Create market-aware price poller invocation function
CREATE OR REPLACE FUNCTION invoke_continuous_price_poller()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  request_id bigint;
  response jsonb;
  market_status record;
  force_polling boolean;
  maintenance_mode boolean;
  should_poll boolean;
BEGIN
  -- Get current market status
  SELECT * INTO market_status FROM get_current_market_status() LIMIT 1;

  -- Check configuration overrides
  force_polling := (SELECT config_value::boolean FROM polling_configuration WHERE config_key = 'force_polling_enabled');
  maintenance_mode := (SELECT config_value::boolean FROM polling_configuration WHERE config_key = 'maintenance_mode');

  -- Determine if we should poll
  should_poll := false;

  IF maintenance_mode THEN
    -- Maintenance mode: never poll
    RAISE NOTICE '🔧 Maintenance mode enabled - skipping poll';
    RETURN jsonb_build_object(
      'polled', false,
      'reason', 'maintenance_mode',
      'market_status', market_status.status
    );
  ELSIF force_polling THEN
    -- Force polling: always poll regardless of market hours
    should_poll := true;
    RAISE NOTICE '🔄 Force polling enabled - polling despite market status: %', market_status.status;
  ELSIF market_status.is_open THEN
    -- Market is open: normal polling
    should_poll := true;
    RAISE NOTICE '📊 Market OPEN - proceeding with poll';
  ELSE
    -- Market is closed: skip polling
    RAISE NOTICE '⏸️  Market CLOSED - skipping poll (Day %, %:%)',
      market_status.day_of_week,
      LPAD(market_status.hour_est::text, 2, '0'),
      LPAD(market_status.minute_est::text, 2, '0');

    RETURN jsonb_build_object(
      'polled', false,
      'reason', 'market_closed',
      'market_status', market_status.status,
      'day_of_week', market_status.day_of_week,
      'time_est', LPAD(market_status.hour_est::text, 2, '0') || ':' || LPAD(market_status.minute_est::text, 2, '0')
    );
  END IF;

  -- If we should poll, invoke the Edge Function
  IF should_poll THEN
    BEGIN
      SELECT net.http_post(
        url := current_setting('app.settings.supabase_url') || '/functions/v1/continuous-price-poller?action=poll',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || current_setting('app.settings.supabase_service_key'),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 10000
      ) INTO request_id;

      RETURN jsonb_build_object(
        'polled', true,
        'request_id', request_id,
        'market_status', market_status.status,
        'forced', force_polling
      );

    EXCEPTION WHEN OTHERS THEN
      -- Log error to polling health table
      INSERT INTO price_polling_health (
        poll_timestamp,
        successful_pairs,
        failed_pairs,
        total_duration_ms,
        error_message
      ) VALUES (
        now(),
        0,
        0,
        0,
        'Cron invocation error: ' || SQLERRM
      );

      RETURN jsonb_build_object(
        'polled', false,
        'reason', 'error',
        'error', SQLERRM
      );
    END;
  END IF;

  RETURN jsonb_build_object(
    'polled', false,
    'reason', 'unknown'
  );
END;
$$;

-- Update the function that calls the poller multiple times per minute
DROP FUNCTION IF EXISTS invoke_price_poller_multiple_times();

CREATE OR REPLACE FUNCTION invoke_price_poller_multiple_times()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  result jsonb;
  poll_count integer := 0;
  skip_count integer := 0;
BEGIN
  -- Call the poller 20 times with 3-second intervals (20 * 3s = 60s)
  -- Market hours check happens in each invocation
  FOR i IN 1..20 LOOP
    result := invoke_continuous_price_poller();

    IF (result->>'polled')::boolean THEN
      poll_count := poll_count + 1;
    ELSE
      skip_count := skip_count + 1;
      -- If market is closed, no need to keep checking every 3 seconds
      -- Check once per minute instead
      IF (result->>'reason') = 'market_closed' THEN
        EXIT; -- Exit loop early, we'll check again next minute
      END IF;
    END IF;

    -- Sleep for 3 seconds between polls (except on last iteration)
    IF i < 20 THEN
      PERFORM pg_sleep(3);
    END IF;
  END LOOP;

  -- Log summary if there were any polls
  IF poll_count > 0 THEN
    RAISE NOTICE '✅ Polling cycle complete: % polls executed, % skipped', poll_count, skip_count;
  ELSIF skip_count > 0 THEN
    RAISE NOTICE '⏸️  Polling cycle skipped: Market closed or maintenance mode';
  END IF;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION invoke_continuous_price_poller() TO postgres;
GRANT EXECUTE ON FUNCTION invoke_price_poller_multiple_times() TO postgres;

-- The existing cron job (continuous-price-polling) will now use the updated function
-- No need to reschedule as it's already set to run every minute

-- Log the update
DO $$
BEGIN
  RAISE NOTICE '✅ Updated continuous price polling system with market hours awareness';
  RAISE NOTICE '   - Polling will automatically pause when market is closed (Friday 5pm - Sunday 5pm EST)';
  RAISE NOTICE '   - Polling will automatically resume when market opens (Sunday 5pm EST)';
  RAISE NOTICE '   - Manual overrides available via polling_configuration table';
END $$;
