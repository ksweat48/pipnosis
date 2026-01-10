/*
  # Fix Intent Expiration and Scan Scheduling

  1. Database Function Fixes
    - Add null validation to mark_thesis_expired_v2 to prevent 400 errors
    - Return early when entry zones are invalid/null
    - Log warning but continue processing

  2. Automatic Scan Scheduling
    - Create trigger on entry_intents.status changes
    - When status becomes 'timeout', automatically schedule next scan
    - Update goal_sessions.next_scan_time and status

  3. Session Recovery
    - Add function to detect stuck sessions (expired intent but no next_scan_time)
    - Automatically recover by scheduling next scan

  4. Benefits
    - Eliminates 400 errors from invalid entry zones
    - Automatically restarts scanning after intent expiration
    - Prevents UI from freezing in "Waiting for market data" state
    - Self-healing for edge cases
*/

-- 1. Fix mark_thesis_expired_v2 to handle null entry zones gracefully
CREATE OR REPLACE FUNCTION mark_thesis_expired_v2(
  p_entry_intent_id UUID,
  p_user_id UUID,
  p_session_id UUID,
  p_symbol TEXT,
  p_direction TEXT,
  p_structure_anchor NUMERIC,
  p_timeframe TEXT,
  p_thesis_fingerprint TEXT,
  p_abandonment_reason TEXT,
  p_expires_at TIMESTAMPTZ
) RETURNS VOID AS $$
BEGIN
  -- Validate structure anchor (prevent NaN/null from causing errors)
  IF p_structure_anchor IS NULL OR p_structure_anchor != p_structure_anchor THEN
    -- Log warning but don't fail
    RAISE WARNING 'Invalid structure_anchor for intent %, skipping thesis memory', p_entry_intent_id;
    RETURN;
  END IF;

  -- Upsert thesis memory
  INSERT INTO entry_thesis_memory (
    user_id,
    session_id,
    symbol,
    direction,
    structure_anchor,
    timeframe,
    thesis_fingerprint,
    status,
    entry_intent_id,
    expires_at,
    abandonment_count,
    abandonment_reason,
    created_at,
    updated_at
  )
  VALUES (
    p_user_id,
    p_session_id,
    p_symbol,
    p_direction,
    p_structure_anchor,
    p_timeframe,
    p_thesis_fingerprint,
    'EXPIRED',
    p_entry_intent_id,
    p_expires_at,
    1,
    p_abandonment_reason,
    NOW(),
    NOW()
  )
  ON CONFLICT (user_id, session_id, thesis_fingerprint)
  DO UPDATE SET
    status = 'EXPIRED',
    entry_intent_id = p_entry_intent_id,
    expires_at = p_expires_at,
    abandonment_count = entry_thesis_memory.abandonment_count + 1,
    abandonment_reason = p_abandonment_reason,
    updated_at = NOW();

EXCEPTION
  WHEN OTHERS THEN
    -- Log error but don't fail the entire operation
    RAISE WARNING 'Error marking thesis expired for intent %: %', p_entry_intent_id, SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Function to schedule next scan for a session
CREATE OR REPLACE FUNCTION schedule_next_scan_after_intent_expiration()
RETURNS TRIGGER AS $$
DECLARE
  v_scan_interval_minutes INTEGER := 15; -- Default 15 minute interval for intraday
  v_next_scan_time TIMESTAMPTZ;
BEGIN
  -- Only trigger when status changes TO 'timeout' (not already timeout)
  IF NEW.status = 'timeout' AND (OLD.status IS NULL OR OLD.status != 'timeout') THEN

    -- Calculate next scan time
    v_next_scan_time := NOW() + (v_scan_interval_minutes || ' minutes')::INTERVAL;

    -- Update goal_sessions to schedule next scan
    UPDATE goal_sessions
    SET
      status = 'scanning',
      next_scan_time = v_next_scan_time,
      last_scan_time = NOW()
    WHERE id = NEW.session_id
      AND status IN ('trade_pending', 'awaiting_continuation'); -- Only update if in monitoring state

    -- Log for debugging
    RAISE NOTICE 'Scheduled next scan for session % at %', NEW.session_id, v_next_scan_time;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on entry_intents table
DROP TRIGGER IF EXISTS trigger_schedule_scan_after_intent_timeout ON entry_intents;
CREATE TRIGGER trigger_schedule_scan_after_intent_timeout
  AFTER UPDATE OF status ON entry_intents
  FOR EACH ROW
  WHEN (NEW.status = 'timeout')
  EXECUTE FUNCTION schedule_next_scan_after_intent_expiration();

-- 3. Recovery function for stuck sessions
CREATE OR REPLACE FUNCTION recover_stuck_sessions()
RETURNS TABLE(
  session_id UUID,
  recovered BOOLEAN,
  message TEXT
) AS $$
DECLARE
  v_session RECORD;
  v_scan_interval_minutes INTEGER := 15;
  v_next_scan_time TIMESTAMPTZ;
BEGIN
  -- Find sessions with expired intents but no next_scan_time
  FOR v_session IN
    SELECT DISTINCT
      gs.id,
      gs.status,
      gs.next_scan_time,
      ei.status as intent_status,
      ei.created_at as intent_created_at
    FROM goal_sessions gs
    INNER JOIN entry_intents ei ON ei.session_id = gs.id
    WHERE gs.status IN ('scanning', 'trade_pending', 'awaiting_continuation')
      AND ei.status = 'timeout'
      AND (gs.next_scan_time IS NULL OR gs.next_scan_time < NOW() - INTERVAL '30 minutes')
    ORDER BY gs.id
  LOOP
    -- Calculate next scan time
    v_next_scan_time := NOW() + (v_scan_interval_minutes || ' minutes')::INTERVAL;

    -- Update session
    UPDATE goal_sessions
    SET
      status = 'scanning',
      next_scan_time = v_next_scan_time,
      last_scan_time = NOW()
    WHERE id = v_session.id;

    -- Return result
    session_id := v_session.id;
    recovered := TRUE;
    message := format('Recovered stuck session - scheduled next scan at %s', v_next_scan_time);
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add comment explaining usage
COMMENT ON FUNCTION recover_stuck_sessions() IS 'Detects and recovers sessions stuck with expired intents but no next_scan_time. Run periodically or on-demand to auto-heal frozen scanning states.';

-- 4. Add index for performance (using correct enum values)
CREATE INDEX IF NOT EXISTS idx_entry_intents_session_status
  ON entry_intents(session_id, status)
  WHERE status IN ('monitoring', 'timeout', 'canceled');

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION mark_thesis_expired_v2 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION schedule_next_scan_after_intent_expiration TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION recover_stuck_sessions TO authenticated, service_role;