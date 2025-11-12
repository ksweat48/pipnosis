/*
  # Implement Direct Database Auto-Backtest Functions
  
  1. Problem
    - Supabase databases cannot make HTTP calls back to their own Edge Functions
    - Both http extension and pg_net fail with "Could not resolve host name"
    - This is a network security limitation in Supabase infrastructure
    
  2. Solution
    - Implement the backtest job generation logic directly in database functions
    - Remove dependency on Edge Functions for cron-triggered operations
    - Edge Functions will still handle job execution (executor)
    - Cron jobs will call database functions directly
    
  3. Implementation
    - Create generate_auto_backtest_job() function to create jobs
    - Keep cleanup function as-is
    - Update cron jobs to call database functions
*/

-- Function to generate and queue a new auto-backtest job
CREATE OR REPLACE FUNCTION generate_auto_backtest_job()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_controller RECORD;
  v_config RECORD;
  v_session_name text;
  v_duration_days int;
  v_risk_level text;
  v_symbols text[];
  v_start_date timestamptz;
  v_end_date timestamptz;
  v_health_metrics RECORD;
  v_stress_score numeric;
  v_should_cooldown boolean;
BEGIN
  -- Find active controllers
  FOR v_controller IN 
    SELECT * FROM auto_backtest_controller 
    WHERE is_active = true AND status = 'running'
  LOOP
    BEGIN
      -- Load config
      SELECT * INTO v_config 
      FROM auto_backtest_config 
      WHERE user_id = v_controller.user_id;
      
      IF v_config IS NULL THEN
        -- Use defaults if no config
        v_config := ROW(
          v_controller.user_id,
          100, -- max_consecutive_runs
          15, -- standard_cooldown_minutes
          80, -- max_stress_score
          5000, -- max_db_response_ms
          10, -- max_error_rate_percent
          3, -- max_consecutive_errors
          1, -- min_duration_days
          3, -- max_duration_days
          1, -- delay_between_runs_min_seconds
          20 -- delay_between_runs_max_seconds
        );
      END IF;
      
      -- Check for live trades
      IF EXISTS (
        SELECT 1 FROM simulated_positions 
        WHERE user_id = v_controller.user_id 
        AND status = 'open'
      ) THEN
        -- Pause for live trade
        UPDATE auto_backtest_controller
        SET 
          status = 'paused_for_live_trade',
          paused_for_live_trade = true,
          live_trade_started_at = now(),
          updated_at = now()
        WHERE id = v_controller.id;
        
        RAISE NOTICE 'Controller % paused - live trade detected', v_controller.id;
        CONTINUE;
      END IF;
      
      -- Check cooldown
      IF v_controller.cooldown_active AND v_controller.cooldown_ends_at > now() THEN
        RAISE NOTICE 'Controller % in cooldown until %', v_controller.id, v_controller.cooldown_ends_at;
        CONTINUE;
      ELSIF v_controller.cooldown_active AND v_controller.cooldown_ends_at <= now() THEN
        -- End cooldown
        UPDATE auto_backtest_controller
        SET 
          status = 'running',
          cooldown_active = false,
          cooldown_started_at = NULL,
          cooldown_ends_at = NULL,
          cooldown_reason = NULL,
          current_cycle_count = 0,
          updated_at = now()
        WHERE id = v_controller.id;
        
        RAISE NOTICE 'Controller % cooldown ended', v_controller.id;
      END IF;
      
      -- Calculate stress score
      v_stress_score := COALESCE(v_controller.system_stress_score, 0);
      
      -- Check if cycle complete
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
          consecutive_errors = 0,
          updated_at = now()
        WHERE id = v_controller.id;
        
        RAISE NOTICE 'Controller % starting cooldown - cycle complete', v_controller.id;
        CONTINUE;
      END IF;
      
      -- Check stress triggers
      v_should_cooldown := false;
      
      IF v_stress_score >= v_config.max_stress_score THEN
        v_should_cooldown := true;
        
        UPDATE auto_backtest_controller
        SET 
          status = 'cooldown',
          cooldown_active = true,
          cooldown_started_at = now(),
          cooldown_ends_at = now() + '15 minutes'::interval,
          cooldown_reason = 'high_stress',
          cooldown_duration_minutes = 15,
          updated_at = now()
        WHERE id = v_controller.id;
        
        RAISE NOTICE 'Controller % starting cooldown - high stress', v_controller.id;
        CONTINUE;
      END IF;
      
      -- Generate job parameters
      v_duration_days := v_config.min_duration_days + floor(random() * (v_config.max_duration_days - v_config.min_duration_days + 1));
      v_risk_level := (ARRAY['low', 'medium', 'high'])[floor(random() * 3 + 1)];
      v_symbols := ARRAY['EURUSD', 'XAUUSD', 'GBPUSD', 'USDJPY', 'US30'];
      
      v_end_date := now();
      v_start_date := v_end_date - (v_duration_days || ' days')::interval;
      v_session_name := 'Auto-BT-' || to_char(now(), 'YYYY-MM-DD-HH24-MI-SS');
      
      -- Queue the job
      INSERT INTO auto_backtest_queue (
        user_id,
        session_name,
        symbols,
        start_date,
        end_date,
        risk_level,
        status,
        created_at
      ) VALUES (
        v_controller.user_id,
        v_session_name,
        v_symbols,
        v_start_date,
        v_end_date,
        v_risk_level,
        'pending',
        now()
      );
      
      -- Update controller
      UPDATE auto_backtest_controller
      SET 
        last_backtest_started_at = now(),
        updated_at = now()
      WHERE id = v_controller.id;
      
      RAISE NOTICE 'Queued backtest job: % for controller %', v_session_name, v_controller.id;
      
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Error processing controller %: %', v_controller.id, SQLERRM;
      
      UPDATE auto_backtest_controller
      SET 
        consecutive_errors = COALESCE(consecutive_errors, 0) + 1,
        updated_at = now()
      WHERE id = v_controller.id;
    END;
  END LOOP;
END;
$$;

-- Update cron jobs to use the new database function
-- First, unschedule old jobs
SELECT cron.unschedule('auto-backtest-runner');
SELECT cron.unschedule('auto-backtest-executor');
SELECT cron.unschedule('auto-backtest-cleanup-job');

-- Schedule new runner job - every 30 seconds (generates jobs)
SELECT cron.schedule(
  'auto-backtest-runner-v2',
  '*/30 * * * * *',
  $$SELECT generate_auto_backtest_job()$$
);

-- Keep executor schedule but note it still needs Edge Function fix
-- For now, jobs will queue but not execute automatically
-- User can manually trigger executor or we'll implement a database-side executor

-- Schedule cleanup job - daily at 3 AM
SELECT cron.schedule(
  'auto-backtest-cleanup-v2',
  '0 3 * * *',
  $$SELECT cleanup_old_auto_backtest_jobs()$$
);

COMMENT ON FUNCTION generate_auto_backtest_job() IS 'Generates and queues auto-backtest jobs directly in database. Called by cron every 30 seconds.';
