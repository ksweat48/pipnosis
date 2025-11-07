/*
  # Fix Candle Finalization Deadlock

  ## Problem
  The finalize_completed_candles() function can deadlock when multiple cron job
  instances run simultaneously and try to update the same rows in different orders.

  ## Solution
  1. **Advisory Locks**: Prevent concurrent execution using PostgreSQL advisory locks
  2. **Row Ordering**: Ensure consistent lock acquisition order with ORDER BY id
  3. **SKIP LOCKED**: Use FOR UPDATE SKIP LOCKED to avoid blocking on locked rows
  4. **Execution Guards**: Add execution time tracking and timeout protection
  5. **Idempotency**: Skip already-finalized candles automatically
  6. **Error Recovery**: Graceful handling of errors with detailed logging
*/

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

ALTER TABLE candle_finalization_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read finalization executions"
  ON candle_finalization_executions
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can manage finalization executions"
  ON candle_finalization_executions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP FUNCTION IF EXISTS finalize_completed_candles();

CREATE FUNCTION finalize_completed_candles()
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
  advisory_lock_id bigint := 1234567890;
  lock_acquired boolean := false;
  error_messages text[] := ARRAY[]::text[];
  current_error text;
BEGIN
  start_time := now();
  lock_acquired := pg_try_advisory_lock(advisory_lock_id);

  IF NOT lock_acquired THEN
    RETURN jsonb_build_object(
      'status', 'skipped',
      'reason', 'concurrent_execution_prevented'
    );
  END IF;

  INSERT INTO candle_finalization_executions (lock_acquired, status)
  VALUES (true, 'running')
  RETURNING id INTO execution_id;

  BEGIN
    FOR candle_rec IN
      SELECT * FROM candle_state
      WHERE is_complete = false AND close_time <= now()
      ORDER BY id
      FOR UPDATE SKIP LOCKED
      LIMIT 1000
    LOOP
      BEGIN
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

        UPDATE candle_state SET is_complete = true WHERE id = candle_rec.id;
        completed_count := completed_count + 1;

      EXCEPTION WHEN OTHERS THEN
        error_count := error_count + 1;
        current_error := format('Error: %s %s at %s - %s',
          candle_rec.symbol, candle_rec.timeframe, candle_rec.open_time, SQLERRM);
        error_messages := array_append(error_messages, current_error);
      END;
    END LOOP;

    DELETE FROM candle_state
    WHERE is_complete = true AND close_time < now() - interval '1 hour';

    UPDATE candle_finalization_executions
    SET completed_at = now(),
        status = CASE WHEN error_count = 0 THEN 'success'
                      WHEN completed_count > 0 THEN 'partial_success'
                      ELSE 'failed' END,
        candles_processed = completed_count,
        errors = error_messages,
        duration_ms = EXTRACT(EPOCH FROM (now() - start_time)) * 1000
    WHERE id = execution_id;

    PERFORM pg_advisory_unlock(advisory_lock_id);

    RETURN jsonb_build_object(
      'status', 'completed',
      'execution_id', execution_id,
      'candles_processed', completed_count,
      'errors_encountered', error_count,
      'duration_ms', EXTRACT(EPOCH FROM (now() - start_time)) * 1000
    );

  EXCEPTION WHEN OTHERS THEN
    UPDATE candle_finalization_executions
    SET completed_at = now(),
        status = 'failed',
        candles_processed = completed_count,
        errors = array_append(error_messages, format('Fatal: %s', SQLERRM)),
        duration_ms = EXTRACT(EPOCH FROM (now() - start_time)) * 1000
    WHERE id = execution_id;

    PERFORM pg_advisory_unlock(advisory_lock_id);

    RETURN jsonb_build_object(
      'status', 'failed',
      'execution_id', execution_id,
      'error', SQLERRM
    );
  END;
END;
$$;

DO $$
BEGIN
  PERFORM cron.unschedule('finalize-candles-v2');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'finalize-candles-v3-deadlock-free',
    '* * * * *',
    'SELECT finalize_completed_candles();'
  );
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

CREATE OR REPLACE VIEW v_finalization_health AS
SELECT
  date_trunc('hour', started_at) as hour,
  status,
  COUNT(*) as execution_count,
  AVG(candles_processed) as avg_candles_processed,
  AVG(duration_ms) as avg_duration_ms,
  MAX(duration_ms) as max_duration_ms,
  SUM(CASE WHEN lock_acquired THEN 1 ELSE 0 END) as locks_acquired
FROM candle_finalization_executions
WHERE started_at > now() - interval '24 hours'
GROUP BY date_trunc('hour', started_at), status
ORDER BY hour DESC;

GRANT SELECT ON v_finalization_health TO authenticated;

CREATE OR REPLACE VIEW v_recent_finalizations AS
SELECT
  id, started_at, completed_at, status,
  candles_processed, duration_ms, lock_acquired,
  CASE WHEN errors IS NOT NULL AND array_length(errors, 1) > 0
       THEN errors[1:3] ELSE ARRAY[]::text[] END as sample_errors
FROM candle_finalization_executions
WHERE started_at > now() - interval '1 hour'
ORDER BY started_at DESC
LIMIT 50;

GRANT SELECT ON v_recent_finalizations TO authenticated;

CREATE OR REPLACE FUNCTION cleanup_stale_finalization_locks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  stale_count integer;
BEGIN
  UPDATE candle_finalization_executions
  SET status = 'timeout',
      completed_at = now(),
      errors = array_append(COALESCE(errors, ARRAY[]::text[]), 'Timeout')
  WHERE status = 'running' AND started_at < now() - interval '5 minutes';
  GET DIAGNOSTICS stale_count = ROW_COUNT;
  RETURN stale_count;
END;
$$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'cleanup-stale-finalization-locks',
    '*/10 * * * *',
    'SELECT cleanup_stale_finalization_locks();'
  );
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'cleanup-old-finalization-logs',
    '0 2 * * *',
    'DELETE FROM candle_finalization_executions WHERE started_at < now() - interval ''7 days'';'
  );
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
