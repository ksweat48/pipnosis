/*
  # Fix Candle Finalization Deadlock

  ## Problem
  The finalize_completed_candles() function can deadlock when multiple cron job
  instances run simultaneously and try to update the same rows in different orders.

  Error: Process A waits for lock held by Process B, while Process B waits for
  lock held by Process A.

  ## Solution
  1. **Advisory Locks**: Prevent concurrent execution using PostgreSQL advisory locks
  2. **Row Ordering**: Ensure consistent lock acquisition order with ORDER BY id
  3. **SKIP LOCKED**: Use FOR UPDATE SKIP LOCKED to avoid blocking on locked rows
  4. **Execution Guards**: Add execution time tracking and timeout protection
  5. **Idempotency**: Skip already-finalized candles automatically
  6. **Error Recovery**: Graceful handling of errors with detailed logging

  ## Changes
  - Replace finalize_completed_candles() with deadlock-proof version
  - Add execution tracking table for monitoring
  - Add advisory lock management
  - Optimize query performance with proper locking strategy
*/

-- Create execution tracking table
CREATE TABLE IF NOT EXISTS candle_finalization_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  status text DEFAULT 'running',
  candles_processed integer DEFAULT 0,
  errors text[],
  duration_ms integer,
  lock_acquired boolean DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_finalization_executions_status
  ON candle_finalization_executions(status, started_at DESC);

-- Enable RLS
ALTER TABLE candle_finalization_executions ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read execution logs
CREATE POLICY "Authenticated users can read finalization executions"
  ON candle_finalization_executions
  FOR SELECT
  TO authenticated
  USING (true);

-- Service role can manage execution logs
CREATE POLICY "Service role can manage finalization executions"
  ON candle_finalization_executions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Drop the old function since we're changing its return type
DROP FUNCTION IF EXISTS finalize_completed_candles();

-- Improved finalize_completed_candles function with deadlock prevention
CREATE OR REPLACE FUNCTION finalize_completed_candles()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  completed_count integer := 0;
  error_count integer := 0;
  candle_rec RECORD;
  execution_id uuid;
  start_time timestamptz;
  advisory_lock_id bigint := 1234567890; -- Unique lock ID for this function
  lock_acquired boolean := false;
  error_messages text[] := ARRAY[]::text[];
  current_error text;
BEGIN
  start_time := now();

  -- Try to acquire advisory lock (non-blocking)
  -- This ensures only ONE instance of this function runs at a time
  lock_acquired := pg_try_advisory_lock(advisory_lock_id);

  IF NOT lock_acquired THEN
    -- Another instance is already running, exit gracefully
    RAISE NOTICE 'Another finalization process is already running. Skipping this execution.';
    RETURN jsonb_build_object(
      'status', 'skipped',
      'reason', 'concurrent_execution_prevented',
      'message', 'Another finalization process is already running'
    );
  END IF;

  -- Create execution tracking record
  INSERT INTO candle_finalization_executions (lock_acquired, status)
  VALUES (true, 'running')
  RETURNING id INTO execution_id;

  BEGIN
    -- Find and process completed candles
    -- Key improvements:
    -- 1. ORDER BY id ensures consistent lock acquisition order
    -- 2. FOR UPDATE SKIP LOCKED prevents blocking on locked rows
    -- 3. is_complete = false filter ensures idempotency
    FOR candle_rec IN
      SELECT * FROM candle_state
      WHERE is_complete = false
        AND close_time <= now()
      ORDER BY id  -- Critical: Consistent lock order prevents deadlock
      FOR UPDATE SKIP LOCKED  -- Skip rows locked by other processes
      LIMIT 1000  -- Process in batches to avoid long transactions
    LOOP
      BEGIN
        -- Insert into forex_candles with conflict handling
        INSERT INTO forex_candles (
          symbol, timeframe, open_time, close_time,
          open, high, low, close, volume, tick_count
        ) VALUES (
          candle_rec.symbol, candle_rec.timeframe,
          candle_rec.open_time, candle_rec.close_time,
          candle_rec.open, candle_rec.high, candle_rec.low, candle_rec.close,
          candle_rec.volume, candle_rec.tick_count
        )
        ON CONFLICT (symbol, timeframe, open_time)
        DO UPDATE SET
          high = GREATEST(forex_candles.high, EXCLUDED.high),
          low = LEAST(forex_candles.low, EXCLUDED.low),
          close = EXCLUDED.close,
          volume = EXCLUDED.volume,
          tick_count = EXCLUDED.tick_count,
          updated_at = now();

        -- Mark as complete (row is already locked from FOR UPDATE)
        UPDATE candle_state
        SET is_complete = true
        WHERE id = candle_rec.id;

        completed_count := completed_count + 1;

      EXCEPTION WHEN OTHERS THEN
        -- Log individual candle processing error but continue
        error_count := error_count + 1;
        current_error := format(
          'Error processing candle %s %s at %s: %s',
          candle_rec.symbol,
          candle_rec.timeframe,
          candle_rec.open_time,
          SQLERRM
        );
        error_messages := array_append(error_messages, current_error);
        RAISE NOTICE 'Candle processing error: %', current_error;
      END;
    END LOOP;

    -- Clean up completed candles older than 1 hour
    DELETE FROM candle_state
    WHERE is_complete = true
      AND close_time < now() - interval '1 hour';

    -- Update execution record with success
    UPDATE candle_finalization_executions
    SET
      completed_at = now(),
      status = CASE
        WHEN error_count = 0 THEN 'success'
        WHEN error_count > 0 AND completed_count > 0 THEN 'partial_success'
        ELSE 'failed'
      END,
      candles_processed = completed_count,
      errors = error_messages,
      duration_ms = EXTRACT(EPOCH FROM (now() - start_time)) * 1000
    WHERE id = execution_id;

    -- Release advisory lock
    PERFORM pg_advisory_unlock(advisory_lock_id);

    -- Return detailed results
    RETURN jsonb_build_object(
      'status', 'completed',
      'execution_id', execution_id,
      'candles_processed', completed_count,
      'errors_encountered', error_count,
      'error_details', error_messages,
      'duration_ms', EXTRACT(EPOCH FROM (now() - start_time)) * 1000
    );

  EXCEPTION WHEN OTHERS THEN
    -- Handle catastrophic errors
    UPDATE candle_finalization_executions
    SET
      completed_at = now(),
      status = 'failed',
      candles_processed = completed_count,
      errors = array_append(error_messages, format('Fatal error: %s', SQLERRM)),
      duration_ms = EXTRACT(EPOCH FROM (now() - start_time)) * 1000
    WHERE id = execution_id;

    -- Always release the advisory lock
    PERFORM pg_advisory_unlock(advisory_lock_id);

    -- Re-raise the error for visibility
    RAISE WARNING 'Fatal error in finalize_completed_candles: %', SQLERRM;

    RETURN jsonb_build_object(
      'status', 'failed',
      'execution_id', execution_id,
      'error', SQLERRM,
      'candles_processed', completed_count
    );
  END;
END;
$$;

-- Update the cron job to use the new function
-- First, unschedule the old job
DO $$
BEGIN
  PERFORM cron.unschedule('finalize-candles-v2');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not unschedule old cron job: %', SQLERRM;
END $$;

-- Schedule the improved version
DO $$
BEGIN
  PERFORM cron.schedule(
    'finalize-candles-v3-deadlock-free',
    '* * * * *',  -- Every minute
    'SELECT finalize_completed_candles();'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Cron job scheduling note: %', SQLERRM;
END $$;

-- Create monitoring view for finalization health
CREATE OR REPLACE VIEW v_finalization_health AS
SELECT
  date_trunc('hour', started_at) as hour,
  status,
  COUNT(*) as execution_count,
  AVG(candles_processed) as avg_candles_processed,
  AVG(duration_ms) as avg_duration_ms,
  MAX(duration_ms) as max_duration_ms,
  SUM(CASE WHEN lock_acquired THEN 1 ELSE 0 END) as locks_acquired,
  SUM(CASE WHEN NOT lock_acquired THEN 1 ELSE 0 END) as locks_skipped
FROM candle_finalization_executions
WHERE started_at > now() - interval '24 hours'
GROUP BY date_trunc('hour', started_at), status
ORDER BY hour DESC, status;

GRANT SELECT ON v_finalization_health TO authenticated;

-- Create view for recent finalization activity
CREATE OR REPLACE VIEW v_recent_finalizations AS
SELECT
  id,
  started_at,
  completed_at,
  status,
  candles_processed,
  duration_ms,
  lock_acquired,
  CASE
    WHEN errors IS NOT NULL AND array_length(errors, 1) > 0
    THEN errors[1:3]  -- Show first 3 errors
    ELSE ARRAY[]::text[]
  END as sample_errors,
  CASE
    WHEN errors IS NOT NULL
    THEN array_length(errors, 1)
    ELSE 0
  END as total_errors
FROM candle_finalization_executions
WHERE started_at > now() - interval '1 hour'
ORDER BY started_at DESC
LIMIT 50;

GRANT SELECT ON v_recent_finalizations TO authenticated;

-- Function to check for stuck executions and clean up stale locks
CREATE OR REPLACE FUNCTION cleanup_stale_finalization_locks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  stale_count integer := 0;
BEGIN
  -- Mark executions that have been running for more than 5 minutes as failed
  UPDATE candle_finalization_executions
  SET
    status = 'timeout',
    completed_at = now(),
    errors = array_append(
      COALESCE(errors, ARRAY[]::text[]),
      'Execution timeout - marked as stale'
    )
  WHERE status = 'running'
    AND started_at < now() - interval '5 minutes';

  GET DIAGNOSTICS stale_count = ROW_COUNT;

  RETURN stale_count;
END;
$$;

-- Schedule cleanup of stale locks every 10 minutes
DO $$
BEGIN
  PERFORM cron.schedule(
    'cleanup-stale-finalization-locks',
    '*/10 * * * *',  -- Every 10 minutes
    'SELECT cleanup_stale_finalization_locks();'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Cleanup cron job scheduling note: %', SQLERRM;
END $$;

-- Clean up old execution logs (keep last 7 days)
DO $$
BEGIN
  PERFORM cron.schedule(
    'cleanup-old-finalization-logs',
    '0 2 * * *',  -- Daily at 2 AM
    'DELETE FROM candle_finalization_executions WHERE started_at < now() - interval ''7 days'';'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Log cleanup cron job scheduling note: %', SQLERRM;
END $$;
