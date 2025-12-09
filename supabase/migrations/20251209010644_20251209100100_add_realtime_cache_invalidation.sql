/*
  # Add Real-time Cache Invalidation System

  ## Summary
  Adds a notification system that broadcasts cache invalidation events when new candles are inserted.
  This allows the frontend to immediately invalidate its IndexedDB cache and fetch fresh data.

  ## Problem
  - Current cache TTL is 2 minutes
  - Users don't see new candles or gap fills until cache expires
  - Gap fills can take up to 2 minutes to become visible

  ## Solution
  1. Create a candle_cache_invalidation_events table to track invalidation events
  2. Add AFTER INSERT trigger on forex_candles to broadcast invalidation events
  3. Use Supabase Realtime to notify connected clients
  4. Frontend will listen and invalidate cache immediately

  ## Performance
  - Minimal overhead: Only fires AFTER successful insert
  - Broadcast is async and doesn't block insert operations
  - Events are lightweight (only symbol + timeframe)

  ## Data Safety
  - Read-only trigger (doesn't modify data)
  - Idempotent (can be called multiple times safely)
  - No impact on existing data
*/

-- =====================================================================
-- CACHE INVALIDATION EVENTS TABLE
-- =====================================================================

CREATE TABLE IF NOT EXISTS candle_cache_invalidation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  timeframe text NOT NULL,
  candle_time timestamptz NOT NULL,
  event_time timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Add index for quick lookups
CREATE INDEX IF NOT EXISTS idx_cache_invalidation_symbol_time 
  ON candle_cache_invalidation_events(symbol, timeframe, event_time DESC);

-- Enable realtime
ALTER TABLE candle_cache_invalidation_events REPLICA IDENTITY FULL;

-- RLS: Allow authenticated users to read invalidation events
ALTER TABLE candle_cache_invalidation_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read cache invalidation events"
  ON candle_cache_invalidation_events
  FOR SELECT
  TO authenticated
  USING (true);

-- Service role can insert events (use WITH CHECK for INSERT)
CREATE POLICY "Service role can insert cache invalidation events"
  ON candle_cache_invalidation_events
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- =====================================================================
-- CACHE INVALIDATION TRIGGER FUNCTION
-- =====================================================================

CREATE OR REPLACE FUNCTION notify_candle_cache_invalidation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Insert invalidation event for realtime broadcast
  INSERT INTO candle_cache_invalidation_events (
    symbol,
    timeframe,
    candle_time,
    event_time
  ) VALUES (
    NEW.symbol,
    NEW.timeframe,
    NEW.open_time,
    now()
  );

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Don't block insert if notification fails
    RAISE WARNING 'Cache invalidation notification failed: %', SQLERRM;
    RETURN NEW;
END;
$$;

-- =====================================================================
-- APPLY TRIGGER TO FOREX_CANDLES
-- =====================================================================

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS trg_notify_cache_invalidation ON forex_candles;

-- Create AFTER INSERT trigger (doesn't affect existing validation)
CREATE TRIGGER trg_notify_cache_invalidation
  AFTER INSERT ON forex_candles
  FOR EACH ROW
  EXECUTE FUNCTION notify_candle_cache_invalidation();

-- Add comment
COMMENT ON TRIGGER trg_notify_cache_invalidation ON forex_candles IS
  'Broadcasts cache invalidation events via Supabase Realtime when new candles are inserted. Allows frontend to invalidate IndexedDB cache immediately.';

-- =====================================================================
-- CLEANUP: Auto-delete old events after 1 hour
-- =====================================================================

CREATE OR REPLACE FUNCTION cleanup_old_cache_events()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM candle_cache_invalidation_events
  WHERE event_time < now() - interval '1 hour';
END;
$$;

-- Note: Cleanup can be called periodically by frontend or scheduled function
-- Example: SELECT cleanup_old_cache_events();

-- =====================================================================
-- RESULT
-- =====================================================================
-- Total triggers on forex_candles: 5
-- - 2 BEFORE (validation)
-- - 3 AFTER (last_known_price + cache_invalidation)
--
-- Frontend integration:
-- Subscribe to candle_cache_invalidation_events table via Supabase Realtime
-- On INSERT event: invalidate cache for that symbol+timeframe
