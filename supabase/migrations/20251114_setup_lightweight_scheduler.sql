/*
  # Setup Lightweight Job Scheduler

  1. Purpose
    - Replace resource-intensive continuous polling with smart scheduling
    - Check for pending jobs once per minute (not every 15 seconds!)
    - Only trigger processor when jobs are actually pending
    - Include resource usage checks before processing

  2. Cron Job
    - job-scheduler: Runs once per minute
    - Checks for pending jobs
    - Triggers job-processor Edge Function if jobs exist
    - Monitors database resource usage

  3. Security
    - Only service role can invoke scheduler
    - Resource usage checks prevent overload
    - Circuit breaker pattern for safety
*/

-- =====================================================
-- 1. SCHEDULE LIGHTWEIGHT JOB CHECKER (ONCE PER MINUTE)
-- =====================================================

-- This is the ONLY cron job that checks for backtest jobs
-- It runs once per minute (not every 15 seconds!)
-- It only triggers processing if jobs actually exist
SELECT cron.schedule(
  job_name := 'job-scheduler'::text,
  schedule := '* * * * *'::text,
  command := $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/job-scheduler',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    timeout_milliseconds := 30000
  ) AS request_id;
  $$::text
);

-- =====================================================
-- 2. CREATE RESOURCE MONITORING TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS database_resource_monitoring (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  active_connections integer NOT NULL,
  max_connections integer NOT NULL,
  connection_usage_percentage numeric NOT NULL,
  active_cron_jobs integer NOT NULL,
  active_queries integer NOT NULL,
  status text NOT NULL CHECK (status IN ('healthy', 'warning', 'critical')),
  cpu_status text,
  memory_status text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resource_monitoring_created
  ON database_resource_monitoring(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_resource_monitoring_status
  ON database_resource_monitoring(status, created_at DESC);

-- Enable RLS
ALTER TABLE database_resource_monitoring ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view resource monitoring"
  ON database_resource_monitoring FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can insert resource monitoring"
  ON database_resource_monitoring FOR INSERT
  TO service_role
  WITH CHECK (true);

-- =====================================================
-- 3. CREATE RESOURCE MONITORING FUNCTION
-- =====================================================

CREATE OR REPLACE FUNCTION log_resource_usage()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_resource_data jsonb;
BEGIN
  -- Get resource usage
  v_resource_data := check_database_resource_usage();

  -- Insert monitoring record
  INSERT INTO database_resource_monitoring (
    active_connections,
    max_connections,
    connection_usage_percentage,
    active_cron_jobs,
    active_queries,
    status
  ) VALUES (
    (v_resource_data->>'active_connections')::integer,
    (v_resource_data->>'max_connections')::integer,
    (v_resource_data->>'connection_usage_percentage')::numeric,
    (v_resource_data->>'active_cron_jobs')::integer,
    0, -- Will be enhanced later
    v_resource_data->>'status'
  );

  -- Cleanup old records (keep last 24 hours)
  DELETE FROM database_resource_monitoring
  WHERE created_at < now() - interval '24 hours';
END;
$$;

-- =====================================================
-- 4. SCHEDULE RESOURCE MONITORING (EVERY 5 MINUTES)
-- =====================================================

SELECT cron.schedule(
  job_name := 'monitor-database-resources'::text,
  schedule := '*/5 * * * *'::text,
  command := 'SELECT log_resource_usage();'::text
);

-- =====================================================
-- 5. CREATE CIRCUIT BREAKER TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS circuit_breaker_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circuit_name text UNIQUE NOT NULL,
  status text NOT NULL DEFAULT 'closed' CHECK (status IN ('closed', 'open', 'half_open')),
  failure_count integer DEFAULT 0,
  last_failure_time timestamptz,
  opened_at timestamptz,
  last_success_time timestamptz,
  consecutive_successes integer DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE circuit_breaker_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view circuit breakers"
  ON circuit_breaker_status FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can manage circuit breakers"
  ON circuit_breaker_status FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Initialize circuit breakers
INSERT INTO circuit_breaker_status (circuit_name, status)
VALUES
  ('job_processor', 'closed'),
  ('backtest_executor', 'closed'),
  ('ai_training', 'closed')
ON CONFLICT (circuit_name) DO NOTHING;

-- =====================================================
-- 6. CREATE CIRCUIT BREAKER FUNCTIONS
-- =====================================================

CREATE OR REPLACE FUNCTION check_circuit_breaker(p_circuit_name text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_status text;
  v_opened_at timestamptz;
BEGIN
  SELECT status, opened_at INTO v_status, v_opened_at
  FROM circuit_breaker_status
  WHERE circuit_name = p_circuit_name;

  -- If circuit is closed, allow
  IF v_status = 'closed' THEN
    RETURN true;
  END IF;

  -- If circuit is open, check if enough time has passed (5 minutes)
  IF v_status = 'open' AND v_opened_at + interval '5 minutes' < now() THEN
    -- Try half-open state
    UPDATE circuit_breaker_status
    SET status = 'half_open', updated_at = now()
    WHERE circuit_name = p_circuit_name;
    RETURN true;
  END IF;

  -- Circuit is still open
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION record_circuit_success(p_circuit_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE circuit_breaker_status
  SET
    consecutive_successes = consecutive_successes + 1,
    failure_count = 0,
    last_success_time = now(),
    status = CASE
      WHEN status = 'half_open' AND consecutive_successes >= 2 THEN 'closed'
      ELSE status
    END,
    updated_at = now()
  WHERE circuit_name = p_circuit_name;
END;
$$;

CREATE OR REPLACE FUNCTION record_circuit_failure(p_circuit_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE circuit_breaker_status
  SET
    failure_count = failure_count + 1,
    consecutive_successes = 0,
    last_failure_time = now(),
    status = CASE
      WHEN failure_count + 1 >= 3 THEN 'open'  -- Open after 3 failures
      ELSE status
    END,
    opened_at = CASE
      WHEN failure_count + 1 >= 3 THEN now()
      ELSE opened_at
    END,
    updated_at = now()
  WHERE circuit_name = p_circuit_name;
END;
$$;

GRANT EXECUTE ON FUNCTION check_circuit_breaker(text) TO service_role;
GRANT EXECUTE ON FUNCTION record_circuit_success(text) TO service_role;
GRANT EXECUTE ON FUNCTION record_circuit_failure(text) TO service_role;

-- =====================================================
-- 7. CREATE MONITORING VIEWS
-- =====================================================

CREATE OR REPLACE VIEW recent_resource_usage AS
SELECT
  date_trunc('minute', created_at) as minute,
  AVG(connection_usage_percentage) as avg_connection_usage,
  MAX(connection_usage_percentage) as max_connection_usage,
  COUNT(*) FILTER (WHERE status = 'critical') as critical_count,
  COUNT(*) FILTER (WHERE status = 'warning') as warning_count,
  COUNT(*) FILTER (WHERE status = 'healthy') as healthy_count
FROM database_resource_monitoring
WHERE created_at > now() - interval '1 hour'
GROUP BY date_trunc('minute', created_at)
ORDER BY minute DESC;

GRANT SELECT ON recent_resource_usage TO authenticated;

CREATE OR REPLACE VIEW system_health_summary AS
SELECT
  (SELECT COUNT(*) FROM job_queue WHERE status = 'pending') as pending_jobs,
  (SELECT COUNT(*) FROM job_queue WHERE status = 'running') as running_jobs,
  (SELECT COUNT(*) FROM circuit_breaker_status WHERE status = 'open') as open_circuits,
  (SELECT status FROM database_resource_monitoring ORDER BY created_at DESC LIMIT 1) as current_resource_status,
  (SELECT connection_usage_percentage FROM database_resource_monitoring ORDER BY created_at DESC LIMIT 1) as current_connection_usage,
  (SELECT COUNT(*) FROM cron.job WHERE active = true) as active_cron_jobs;

GRANT SELECT ON system_health_summary TO authenticated;

COMMENT ON VIEW system_health_summary IS 'Real-time system health overview for monitoring dashboard';

-- =====================================================
-- 8. LOG SETUP COMPLETION
-- =====================================================

INSERT INTO cron_job_execution_log (job_name, status, result)
VALUES (
  'lightweight-scheduler-setup',
  'completed',
  jsonb_build_object(
    'setup', 'complete',
    'scheduler', 'runs once per minute',
    'resource_monitoring', 'enabled every 5 minutes',
    'circuit_breakers', 'enabled',
    'note', 'Lightweight architecture replaces resource-intensive polling'
  )
);
