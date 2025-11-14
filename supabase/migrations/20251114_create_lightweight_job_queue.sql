/*
  # Create Lightweight Job Queue System

  1. Purpose
    - Replace resource-intensive cron jobs with a proper job queue
    - Enable continuous AI training without database exhaustion
    - Process one job at a time with proper resource management
    - Support priority-based job scheduling

  2. Tables
    - job_queue: Main queue for all asynchronous jobs
    - job_execution_log: Detailed execution history with metrics

  3. Job Types
    - backtest: Run backtests for AI training
    - ai_training: Process AI learning from completed backtests
    - data_quality: Run data quality checks
    - cleanup: Database maintenance tasks

  4. Security
    - RLS enabled for authenticated users
    - Service role can manage all jobs
    - Users can only see their own jobs
*/

-- =====================================================
-- 1. CREATE JOB QUEUE TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS job_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL CHECK (job_type IN ('backtest', 'ai_training', 'data_quality', 'cleanup')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  priority integer NOT NULL DEFAULT 50 CHECK (priority >= 1 AND priority <= 100),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  error_message text,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  processing_duration_ms integer,
  retry_count integer DEFAULT 0,
  max_retries integer DEFAULT 3,
  scheduled_for timestamptz DEFAULT now()
);

-- Indexes for efficient job processing
CREATE INDEX IF NOT EXISTS idx_job_queue_status_priority
  ON job_queue(status, priority DESC, created_at ASC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_job_queue_user
  ON job_queue(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_queue_type_status
  ON job_queue(job_type, status, created_at DESC);

-- Enable RLS
ALTER TABLE job_queue ENABLE ROW LEVEL SECURITY;

-- Users can view their own jobs
CREATE POLICY "Users can view own jobs"
  ON job_queue FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can insert their own jobs
CREATE POLICY "Users can create own jobs"
  ON job_queue FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own pending jobs (to cancel)
CREATE POLICY "Users can cancel own pending jobs"
  ON job_queue FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id AND status = 'pending')
  WITH CHECK (auth.uid() = user_id AND status IN ('pending', 'cancelled'));

-- Service role can manage all jobs
CREATE POLICY "Service role full access to jobs"
  ON job_queue FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- 2. CREATE JOB EXECUTION LOG TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS job_execution_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES job_queue(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('started', 'progress', 'completed', 'failed', 'retry')),
  message text,
  progress_percentage integer CHECK (progress_percentage >= 0 AND progress_percentage <= 100),
  metrics jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_execution_log_job_id
  ON job_execution_log(job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_execution_log_created
  ON job_execution_log(created_at DESC);

-- Enable RLS
ALTER TABLE job_execution_log ENABLE ROW LEVEL SECURITY;

-- Users can view logs for their own jobs
CREATE POLICY "Users can view own job logs"
  ON job_execution_log FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM job_queue
      WHERE job_queue.id = job_execution_log.job_id
      AND job_queue.user_id = auth.uid()
    )
  );

-- Service role can manage all logs
CREATE POLICY "Service role full access to logs"
  ON job_execution_log FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- 3. CREATE HELPER FUNCTIONS
-- =====================================================

-- Function to get next pending job
CREATE OR REPLACE FUNCTION get_next_pending_job()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_job_id uuid;
BEGIN
  -- Get highest priority pending job that's ready to run
  SELECT id INTO v_job_id
  FROM job_queue
  WHERE status = 'pending'
    AND scheduled_for <= now()
    AND retry_count < max_retries
  ORDER BY priority DESC, created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  -- Mark as running if found
  IF v_job_id IS NOT NULL THEN
    UPDATE job_queue
    SET
      status = 'running',
      started_at = now()
    WHERE id = v_job_id;

    -- Log the start
    INSERT INTO job_execution_log (job_id, event_type, message)
    VALUES (v_job_id, 'started', 'Job processing started');
  END IF;

  RETURN v_job_id;
END;
$$;

-- Function to complete a job
CREATE OR REPLACE FUNCTION complete_job(
  p_job_id uuid,
  p_status text,
  p_result jsonb DEFAULT NULL,
  p_error_message text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_duration_ms integer;
BEGIN
  -- Calculate duration
  SELECT EXTRACT(EPOCH FROM (now() - started_at)) * 1000
  INTO v_duration_ms
  FROM job_queue
  WHERE id = p_job_id;

  -- Update job status
  UPDATE job_queue
  SET
    status = p_status,
    completed_at = now(),
    result = p_result,
    error_message = p_error_message,
    processing_duration_ms = v_duration_ms
  WHERE id = p_job_id;

  -- Log completion
  INSERT INTO job_execution_log (job_id, event_type, message, metrics)
  VALUES (
    p_job_id,
    CASE WHEN p_status = 'completed' THEN 'completed' ELSE 'failed' END,
    COALESCE(p_error_message, 'Job completed successfully'),
    jsonb_build_object('duration_ms', v_duration_ms)
  );
END;
$$;

-- Function to update job progress
CREATE OR REPLACE FUNCTION update_job_progress(
  p_job_id uuid,
  p_progress_percentage integer,
  p_message text DEFAULT NULL,
  p_metrics jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Log progress
  INSERT INTO job_execution_log (job_id, event_type, message, progress_percentage, metrics)
  VALUES (p_job_id, 'progress', p_message, p_progress_percentage, p_metrics);
END;
$$;

-- Function to retry a failed job
CREATE OR REPLACE FUNCTION retry_job(p_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE job_queue
  SET
    status = 'pending',
    retry_count = retry_count + 1,
    started_at = NULL,
    completed_at = NULL,
    scheduled_for = now() + (interval '1 minute' * POWER(2, retry_count)) -- Exponential backoff
  WHERE id = p_job_id
    AND status = 'failed'
    AND retry_count < max_retries;

  -- Log retry
  INSERT INTO job_execution_log (job_id, event_type, message)
  VALUES (p_job_id, 'retry', 'Job scheduled for retry with exponential backoff');
END;
$$;

-- Function to queue a new job
CREATE OR REPLACE FUNCTION queue_job(
  p_job_type text,
  p_payload jsonb,
  p_user_id uuid DEFAULT NULL,
  p_priority integer DEFAULT 50,
  p_scheduled_for timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_job_id uuid;
BEGIN
  INSERT INTO job_queue (job_type, payload, user_id, priority, scheduled_for)
  VALUES (p_job_type, p_payload, p_user_id, p_priority, p_scheduled_for)
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_next_pending_job() TO service_role;
GRANT EXECUTE ON FUNCTION complete_job(uuid, text, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION update_job_progress(uuid, integer, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION retry_job(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION queue_job(text, jsonb, uuid, integer, timestamptz) TO authenticated, service_role;

-- =====================================================
-- 4. CREATE MONITORING VIEWS
-- =====================================================

-- View for job queue status
CREATE OR REPLACE VIEW job_queue_status AS
SELECT
  job_type,
  status,
  COUNT(*) as job_count,
  AVG(processing_duration_ms) as avg_duration_ms,
  MAX(created_at) as latest_job_created,
  MIN(CASE WHEN status = 'pending' THEN scheduled_for END) as next_scheduled_job
FROM job_queue
GROUP BY job_type, status
ORDER BY job_type, status;

GRANT SELECT ON job_queue_status TO authenticated;

-- View for recent job activity
CREATE OR REPLACE VIEW recent_job_activity AS
SELECT
  jq.id,
  jq.job_type,
  jq.status,
  jq.priority,
  jq.created_at,
  jq.started_at,
  jq.completed_at,
  jq.processing_duration_ms,
  jq.retry_count,
  jq.error_message,
  (
    SELECT COUNT(*)
    FROM job_execution_log
    WHERE job_id = jq.id
  ) as log_entry_count
FROM job_queue jq
WHERE jq.created_at > now() - interval '24 hours'
ORDER BY jq.created_at DESC
LIMIT 100;

GRANT SELECT ON recent_job_activity TO authenticated;

-- =====================================================
-- 5. CREATE CLEANUP FUNCTION
-- =====================================================

CREATE OR REPLACE FUNCTION cleanup_old_jobs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Delete completed jobs older than 7 days
  DELETE FROM job_queue
  WHERE status IN ('completed', 'cancelled')
    AND completed_at < now() - interval '7 days';

  -- Delete failed jobs older than 30 days
  DELETE FROM job_queue
  WHERE status = 'failed'
    AND completed_at < now() - interval '30 days';

  -- Delete old execution logs (cascades from job_queue deletion)
  -- Keep logs for active jobs, delete orphaned logs older than 7 days
  DELETE FROM job_execution_log
  WHERE created_at < now() - interval '7 days'
    AND job_id NOT IN (SELECT id FROM job_queue);
END;
$$;

-- Schedule cleanup to run daily at 3 AM
SELECT cron.schedule(
  'cleanup-old-jobs',
  '0 3 * * *',
  'SELECT cleanup_old_jobs();'
);

COMMENT ON TABLE job_queue IS 'Lightweight job queue for asynchronous processing. Replaces resource-intensive cron jobs.';
COMMENT ON FUNCTION get_next_pending_job IS 'Returns the next job to process based on priority and scheduling. Returns NULL if no jobs available.';
COMMENT ON FUNCTION queue_job IS 'Adds a new job to the queue. Returns the job ID.';
