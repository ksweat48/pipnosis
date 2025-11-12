/*
  # Setup Automatic Monitoring and Repair Cron Jobs

  1. Cron Jobs
    - polling-outage-monitor: Runs every 5 minutes to detect gaps and trigger backfills
    - repair-candles: Runs every hour to fix candle quality issues
    - quality-metrics-calculator: Runs every 15 minutes to update quality stats

  2. Helper Functions
    - Invoke edge functions from cron jobs
    - Log cron job execution results
*/

-- =====================================================
-- 1. ENABLE PG_CRON IF NOT ALREADY ENABLED
-- =====================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- =====================================================
-- 2. CREATE CRON JOB EXECUTION LOG
-- =====================================================

CREATE TABLE IF NOT EXISTS cron_job_execution_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name text NOT NULL,
  execution_time timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK (status IN ('success', 'failed', 'running')),
  duration_ms integer,
  result jsonb,
  error_message text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cron_job_log_name_time
ON cron_job_execution_log(job_name, execution_time DESC);

ALTER TABLE cron_job_execution_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read cron logs"
  ON cron_job_execution_log FOR SELECT
  TO authenticated
  USING (true);

-- =====================================================
-- 3. POLLING OUTAGE MONITOR - EVERY 5 MINUTES
-- =====================================================

SELECT cron.schedule(
  'polling-outage-monitor',
  '*/5 * * * *',
  $$
  INSERT INTO cron_job_execution_log (job_name, status)
  VALUES ('polling-outage-monitor', 'running');

  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/polling-outage-monitor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    )
  ) AS request_id;
  $$
);

COMMENT ON FUNCTION cron.schedule IS 'Polls every 5 minutes to detect outages and trigger backfills';

-- =====================================================
-- 4. CANDLE REPAIR - EVERY HOUR
-- =====================================================

SELECT cron.schedule(
  'repair-candles-hourly',
  '0 * * * *',
  $$
  INSERT INTO cron_job_execution_log (job_name, status)
  VALUES ('repair-candles-hourly', 'running');

  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/repair-candles?hours=24',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    )
  ) AS request_id;
  $$
);

-- =====================================================
-- 5. QUALITY METRICS CALCULATOR - EVERY 15 MINUTES
-- =====================================================

CREATE OR REPLACE FUNCTION calculate_and_store_quality_metrics()
RETURNS void AS $$
DECLARE
  v_symbol text;
  v_timeframe text;
  v_metrics jsonb;
BEGIN
  FOR v_symbol IN SELECT DISTINCT symbol FROM forex_candles LOOP
    FOR v_timeframe IN SELECT DISTINCT timeframe FROM forex_candles WHERE symbol = v_symbol LOOP
      v_metrics := calculate_quality_metrics(v_symbol, v_timeframe, 24);

      INSERT INTO candle_quality_metrics (
        symbol,
        timeframe,
        measurement_time,
        total_candles,
        metaapi_candles,
        gap_fill_candles,
        backfilled_candles,
        complete_candles,
        incomplete_candles,
        quality_score
      ) VALUES (
        v_symbol,
        v_timeframe,
        now(),
        (v_metrics->>'total_candles')::integer,
        (v_metrics->>'metaapi_candles')::integer,
        (v_metrics->>'gap_fill_candles')::integer,
        (v_metrics->>'backfilled_candles')::integer,
        (v_metrics->>'complete_candles')::integer,
        (v_metrics->>'incomplete_candles')::integer,
        (v_metrics->>'quality_percentage')::numeric
      );
    END LOOP;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

SELECT cron.schedule(
  'calculate-quality-metrics',
  '*/15 * * * *',
  $$
  INSERT INTO cron_job_execution_log (job_name, status)
  VALUES ('calculate-quality-metrics', 'running');

  SELECT calculate_and_store_quality_metrics();

  UPDATE cron_job_execution_log
  SET status = 'success', duration_ms = EXTRACT(EPOCH FROM (now() - execution_time)) * 1000
  WHERE job_name = 'calculate-quality-metrics'
  AND status = 'running'
  ORDER BY execution_time DESC
  LIMIT 1;
  $$
);

-- =====================================================
-- 6. CLEANUP OLD LOGS - DAILY AT 3 AM
-- =====================================================

SELECT cron.schedule(
  'cleanup-old-logs',
  '0 3 * * *',
  $$
  DELETE FROM cron_job_execution_log
  WHERE execution_time < now() - interval '7 days';

  DELETE FROM candle_quality_metrics
  WHERE measurement_time < now() - interval '30 days';

  DELETE FROM polling_outage_log
  WHERE run_time < now() - interval '14 days';
  $$
);

-- =====================================================
-- 7. CREATE MONITORING DASHBOARD VIEW
-- =====================================================

CREATE OR REPLACE VIEW cron_job_health AS
SELECT
  job_name,
  COUNT(*) as total_executions,
  COUNT(*) FILTER (WHERE status = 'success') as successful_executions,
  COUNT(*) FILTER (WHERE status = 'failed') as failed_executions,
  MAX(execution_time) as last_execution,
  AVG(duration_ms) as avg_duration_ms,
  CASE
    WHEN MAX(execution_time) < now() - interval '10 minutes' THEN 'stale'
    WHEN COUNT(*) FILTER (WHERE status = 'failed' AND execution_time > now() - interval '1 hour') > 3 THEN 'unhealthy'
    ELSE 'healthy'
  END as health_status
FROM cron_job_execution_log
WHERE execution_time > now() - interval '24 hours'
GROUP BY job_name;

GRANT SELECT ON cron_job_health TO authenticated;

-- =====================================================
-- 8. NOTIFICATION FUNCTION FOR CRITICAL ISSUES
-- =====================================================

CREATE OR REPLACE FUNCTION check_critical_quality_issues()
RETURNS void AS $$
DECLARE
  v_poor_quality_count integer;
  v_high_gap_fill_count integer;
BEGIN
  SELECT COUNT(*)
  INTO v_poor_quality_count
  FROM candle_quality_summary
  WHERE quality_percentage < 50;

  SELECT COUNT(*)
  INTO v_high_gap_fill_count
  FROM candle_quality_summary
  WHERE gap_fill_count::numeric / NULLIF(total_candles, 0) > 0.5;

  IF v_poor_quality_count > 5 OR v_high_gap_fill_count > 5 THEN
    INSERT INTO cron_job_execution_log (job_name, status, error_message)
    VALUES (
      'quality-alert',
      'failed',
      format('CRITICAL: %s symbols with poor quality, %s with high gap fills',
             v_poor_quality_count, v_high_gap_fill_count)
    );
  END IF;
END;
$$ LANGUAGE plpgsql;

SELECT cron.schedule(
  'check-quality-alerts',
  '*/10 * * * *',
  $$SELECT check_critical_quality_issues();$$
);

COMMENT ON TABLE cron_job_execution_log IS 'Tracks execution history of all automated cron jobs';
COMMENT ON FUNCTION calculate_and_store_quality_metrics IS 'Calculates and stores quality metrics for all symbols and timeframes';
COMMENT ON VIEW cron_job_health IS 'Real-time health status of all cron jobs';
