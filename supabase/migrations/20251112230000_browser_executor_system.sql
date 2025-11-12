/*
  # Browser-Based Auto-Backtest Executor System

  1. Problem
    - Cron jobs not running reliably
    - 141+ jobs stuck in queue
    - Need browser-based solution that works 100% of the time

  2. Solution
    - Create database function that can be called from browser
    - Browser polls every 10 seconds and executes jobs
    - No dependency on cron, http extension, or Edge Functions

  3. Functions
    - auto_backtest_runner_cycle() - Creates new jobs if needed
    - execute_pending_backtest_jobs() - Already exists, processes jobs
*/

-- Create runner function that can be called from browser
CREATE OR REPLACE FUNCTION auto_backtest_runner_cycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_controller RECORD;
  v_config RECORD;
  v_job_config jsonb;
  v_jobs_created int := 0;
BEGIN
  RAISE NOTICE '[Runner Cycle] Starting...';

  -- Find active controllers
  FOR v_controller IN
    SELECT * FROM auto_backtest_controller
    WHERE is_active = true AND status = 'running'
  LOOP
    BEGIN
      RAISE NOTICE '[Runner Cycle] Processing controller %', v_controller.id;

      -- Check if in cooldown
      IF v_controller.cooldown_active AND v_controller.cooldown_ends_at > now() THEN
        RAISE NOTICE '[Runner Cycle] Controller % in cooldown', v_controller.id;
        CONTINUE;
      END IF;

      -- End cooldown if expired
      IF v_controller.cooldown_active AND v_controller.cooldown_ends_at <= now() THEN
        UPDATE auto_backtest_controller
        SET
          status = 'running',
          cooldown_active = false,
          cooldown_ends_at = NULL,
          cooldown_reason = NULL,
          current_cycle_count = 0,
          updated_at = now()
        WHERE id = v_controller.id;

        RAISE NOTICE '[Runner Cycle] Cooldown ended for controller %', v_controller.id;
      END IF;

      -- Get config
      SELECT * INTO v_config
      FROM auto_backtest_config
      WHERE user_id = v_controller.user_id;

      IF NOT FOUND THEN
        -- Create default config
        INSERT INTO auto_backtest_config (user_id)
        VALUES (v_controller.user_id)
        RETURNING * INTO v_config;
      END IF;

      -- Check if cycle limit reached
      IF v_controller.current_cycle_count >= v_config.max_consecutive_runs THEN
        UPDATE auto_backtest_controller
        SET
          status = 'cooldown',
          cooldown_active = true,
          cooldown_started_at = now(),
          cooldown_ends_at = now() + (v_config.standard_cooldown_minutes || ' minutes')::interval,
          cooldown_reason = 'cycle_complete',
          cooldown_duration_minutes = v_config.standard_cooldown_minutes,
          current_cycle_count = 0,
          updated_at = now()
        WHERE id = v_controller.id;

        RAISE NOTICE '[Runner Cycle] Cycle complete, entering cooldown';
        CONTINUE;
      END IF;

      -- Check for live trades (pause if any open)
      IF EXISTS (
        SELECT 1 FROM simulated_positions
        WHERE user_id = v_controller.user_id
          AND status = 'open'
      ) THEN
        UPDATE auto_backtest_controller
        SET
          status = 'paused_for_live_trade',
          paused_for_live_trade = true,
          updated_at = now()
        WHERE id = v_controller.id;

        RAISE NOTICE '[Runner Cycle] Live trade detected, pausing';
        CONTINUE;
      ELSE
        -- Resume if was paused
        IF v_controller.paused_for_live_trade THEN
          UPDATE auto_backtest_controller
          SET
            status = 'running',
            paused_for_live_trade = false,
            updated_at = now()
          WHERE id = v_controller.id;
        END IF;
      END IF;

      -- Check if there are already pending jobs
      IF EXISTS (
        SELECT 1 FROM auto_backtest_queue
        WHERE user_id = v_controller.user_id
          AND status = 'pending'
      ) THEN
        RAISE NOTICE '[Runner Cycle] Jobs already pending, skipping creation';
        CONTINUE;
      END IF;

      -- Generate new backtest job
      v_job_config := jsonb_build_object(
        'session_name', 'Auto-BT-' || to_char(now(), 'YYYY-MM-DD-HH24-MI-SS'),
        'duration_days', 1 + floor(random() * (v_config.max_duration_days - v_config.min_duration_days + 1)),
        'risk_level', (ARRAY['low', 'medium', 'high'])[1 + floor(random() * 3)],
        'symbols', ARRAY['EURUSD', 'XAUUSD', 'GBPUSD', 'USDJPY', 'US30'],
        'start_date', now() - ((1 + floor(random() * 2)) || ' days')::interval,
        'end_date', now()
      );

      -- Queue the job
      INSERT INTO auto_backtest_queue (
        user_id,
        session_name,
        symbols,
        start_date,
        end_date,
        risk_level,
        status
      ) VALUES (
        v_controller.user_id,
        v_job_config->>'session_name',
        (v_job_config->>'symbols')::text[],
        (v_job_config->>'start_date')::timestamptz,
        (v_job_config->>'end_date')::timestamptz,
        v_job_config->>'risk_level',
        'pending'
      );

      v_jobs_created := v_jobs_created + 1;
      RAISE NOTICE '[Runner Cycle] Created job: %', v_job_config->>'session_name';

    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[Runner Cycle] Error processing controller %: %', v_controller.id, SQLERRM;

      UPDATE auto_backtest_controller
      SET
        consecutive_errors = COALESCE(consecutive_errors, 0) + 1,
        updated_at = now()
      WHERE id = v_controller.id;
    END;
  END LOOP;

  RAISE NOTICE '[Runner Cycle] Complete: % jobs created', v_jobs_created;

  RETURN jsonb_build_object(
    'success', true,
    'jobs_created', v_jobs_created
  );
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION auto_backtest_runner_cycle() TO authenticated;
GRANT EXECUTE ON FUNCTION execute_pending_backtest_jobs() TO authenticated;

COMMENT ON FUNCTION auto_backtest_runner_cycle() IS
  'Browser-callable function to create new backtest jobs. Called automatically every 10 seconds by browser.';
