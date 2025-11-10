/*
  # Fix Candle Finalization - Remove updated_at Reference

  1. Problem
    - The finalize_completed_candles() function references a non-existent 'updated_at' column
    - This causes all candle finalizations to fail with 1000 errors
    - Server-side polling IS working, but candles aren't being finalized into forex_candles table
    - 1,782+ candles are stuck in candle_state waiting to be finalized

  2. Solution
    - Update the finalize_completed_candles function to remove the updated_at reference
    - Keep all other functionality intact (deadlock prevention, error handling, etc.)

  3. Impact
    - This will immediately fix the candle finalization process
    - All pending candles will start being finalized properly
    - Charts will show live data even when browser is closed
*/

-- Drop and recreate the finalize function without the updated_at reference
CREATE OR REPLACE FUNCTION finalize_completed_candles()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  completed_count integer := 0;
  error_count integer := 0;
  candle_rec RECORD;
  start_time timestamptz;
  execution_id uuid;
  advisory_lock_id bigint := 8675309;  -- Unique lock ID for this function
  lock_acquired boolean := false;
  error_messages text[] := ARRAY[]::text[];
  current_error text;
BEGIN
  start_time := now();

  -- Try to acquire advisory lock (non-blocking)
  lock_acquired := pg_try_advisory_lock(advisory_lock_id);

  IF NOT lock_acquired THEN
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
    FOR candle_rec IN
      SELECT * FROM candle_state
      WHERE is_complete = false
        AND close_time <= now()
      ORDER BY id  -- Consistent lock order prevents deadlock
      FOR UPDATE SKIP LOCKED  -- Skip rows locked by other processes
      LIMIT 1000  -- Process in batches
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
          tick_count = EXCLUDED.tick_count;
          -- REMOVED: updated_at = now() (column doesn't exist)

        -- Mark as complete
        UPDATE candle_state
        SET is_complete = true
        WHERE id = candle_rec.id;

        completed_count := completed_count + 1;

      EXCEPTION WHEN OTHERS THEN
        error_count := error_count + 1;
        current_error := format(
          'Error: %s %s at %s - %s',
          candle_rec.symbol,
          candle_rec.timeframe,
          candle_rec.open_time,
          SQLERRM
        );
        error_messages := array_append(error_messages, current_error);

        -- Stop after 1000 errors to prevent runaway
        IF error_count >= 1000 THEN
          RAISE WARNING 'Stopping finalization: 1000 errors encountered';
          EXIT;
        END IF;
      END;
    END LOOP;

    -- Clean up completed candles older than 1 hour
    DELETE FROM candle_state
    WHERE is_complete = true
      AND close_time < now() - interval '1 hour';

    -- Update execution record with results
    UPDATE candle_finalization_executions
    SET
      completed_at = now(),
      status = 'completed',
      candles_processed = completed_count,
      errors = error_messages,
      duration_ms = EXTRACT(EPOCH FROM (now() - start_time)) * 1000
    WHERE id = execution_id;

    -- Release advisory lock
    PERFORM pg_advisory_unlock(advisory_lock_id);

    -- Return results
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

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION finalize_completed_candles() TO postgres, authenticated, service_role;
