/*
  # CCIP-2026-0501A — Stage 6B Schedule Reasoning Watchers

  Activates the Stage 6A feedback loop by scheduling run_alpha_reasoning_watchers()
  on a fixed interval and persisting a run-history audit trail. Without this,
  the watchers only fire on manual invocation; the loop is armed but idle.

  1. New Tables
    - `alpha_reasoning_watcher_runs`
      One row per watcher execution. Records what the watcher saw at run time
      (NO_TRADE rate, tier calibrations, counter-trend violations, observations
      created). Gives operators a time-series view of Alpha's reasoning health
      without needing to re-query alpha_decisions.

  2. Scheduling
    - pg_cron job 'alpha-reasoning-watchers' runs every 15 minutes.
    - Wraps run_alpha_reasoning_watchers() and logs the result into the new
      audit table. Errors are swallowed (non-blocking on scheduled jobs).

  3. Security
    - Table RLS enabled; authenticated can SELECT (observability); only
      service_role writes via the SECURITY DEFINER wrapper.

  4. Governance
    - CCIP-2026-0501A on every object.
    - Non-blocking: job failures never affect trade execution.
*/

CREATE TABLE IF NOT EXISTS public.alpha_reasoning_watcher_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at timestamptz NOT NULL DEFAULT now(),
  observations_created int DEFAULT 0,
  no_trade_rate_pct numeric,
  no_trade_sample int,
  vc_win_rate_pct numeric,
  vc_sample int,
  ec_win_rate_pct numeric,
  ec_sample int,
  counter_trend_violations int,
  error_message text,
  raw_result jsonb
);

CREATE INDEX IF NOT EXISTS idx_arwr_run_at ON public.alpha_reasoning_watcher_runs(run_at DESC);

ALTER TABLE public.alpha_reasoning_watcher_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "arwr_authenticated_select" ON public.alpha_reasoning_watcher_runs;
CREATE POLICY "arwr_authenticated_select"
  ON public.alpha_reasoning_watcher_runs FOR SELECT
  TO authenticated
  USING (true);

-- Wrapper that runs watchers and logs the outcome. Swallows errors so pg_cron
-- never marks the job failed — we prefer observability over alerting noise.
CREATE OR REPLACE FUNCTION public.run_and_log_alpha_reasoning_watchers()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  BEGIN
    v_result := run_alpha_reasoning_watchers();

    INSERT INTO alpha_reasoning_watcher_runs (
      observations_created, no_trade_rate_pct, no_trade_sample,
      vc_win_rate_pct, vc_sample, ec_win_rate_pct, ec_sample,
      counter_trend_violations, raw_result
    ) VALUES (
      COALESCE((v_result->>'observations_created')::int, 0),
      NULLIF(v_result->>'no_trade_rate_pct','')::numeric,
      NULLIF(v_result->>'no_trade_sample','')::int,
      NULLIF(v_result->>'vc_win_rate_pct','')::numeric,
      NULLIF(v_result->>'vc_sample','')::int,
      NULLIF(v_result->>'ec_win_rate_pct','')::numeric,
      NULLIF(v_result->>'ec_sample','')::int,
      NULLIF(v_result->>'counter_trend_violations','')::int,
      v_result
    );
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO alpha_reasoning_watcher_runs (error_message, raw_result)
    VALUES (SQLERRM, jsonb_build_object('error', SQLERRM, 'state', SQLSTATE));
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.run_and_log_alpha_reasoning_watchers() TO service_role;

-- Schedule every 15 minutes. Unschedule any prior job with the same name first.
DO $$
BEGIN
  PERFORM cron.unschedule('alpha-reasoning-watchers');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'alpha-reasoning-watchers',
  '*/15 * * * *',
  $$SELECT public.run_and_log_alpha_reasoning_watchers();$$
);

-- Deployment log
INSERT INTO ccip_alpha_prompt_deployments (
  change_type, affected_file, affected_function,
  change_description, governance_notes, fix_count
) VALUES (
  'ALPHA_BRAIN_UPGRADE_STAGE_6B',
  'supabase/migrations/20260501_ccip_2026_0501a_stage6b_schedule_reasoning_watchers.sql',
  'run_and_log_alpha_reasoning_watchers + pg_cron alpha-reasoning-watchers',
  'CCIP-2026-0501A Stage 6B — activates the Stage 6A feedback loop. Adds alpha_reasoning_watcher_runs audit table (time-series of what watchers observed). Schedules run_and_log_alpha_reasoning_watchers() via pg_cron every 15 minutes. The wrapper calls run_alpha_reasoning_watchers() and persists NO_TRADE rate, tier calibration, counter-trend violations, and observations-created count. Errors swallowed and logged to the same table.',
  'Non-blocking scheduled job. Job failures never affect trade execution. Prompt still reads only currently-firing observations via get_active_reasoning_health.',
  1
);
