/*
  # Immediate Scan Restart After Intent Abandonment

  1. Changes
    - Update trigger to schedule scan 1 minute after intent expires (down from 15 minutes)
    - Allow system to quickly pivot to new opportunities after abandonment
    - Maintain 15 minute interval for regular scheduled scans

  2. Rationale
    - When an intent is abandoned (timeout, runaway, etc.), there's no reason to wait
    - The 15 minute interval is for regular scanning between opportunities
    - After abandonment, Alpha should immediately look for better setups
    - Prevents wasted time when market conditions change

  3. Safety
    - Still has 1 minute cooldown to prevent thrashing
    - Entry monitor coordinator has additional throttling for repeated failures
    - Pre-flight validation prevents creating non-viable intents

  4. Benefits
    - Maximizes opportunity capture after abandonment
    - Better user experience - immediate action
    - More efficient use of scanning windows
    - Alpha can quickly pivot to better opportunities
*/

-- Update trigger function to schedule immediate scan (1 minute) after intent expiration
CREATE OR REPLACE FUNCTION schedule_next_scan_after_intent_expiration()
RETURNS TRIGGER AS $$
DECLARE
  v_scan_interval_minutes INTEGER := 1; -- CHANGED: 1 minute for immediate restart (down from 15)
  v_next_scan_time TIMESTAMPTZ;
BEGIN
  -- Only trigger when status changes TO 'timeout' (not already timeout)
  IF NEW.status = 'timeout' AND (OLD.status IS NULL OR OLD.status != 'timeout') THEN

    -- Calculate next scan time (1 minute from now for immediate restart)
    v_next_scan_time := NOW() + (v_scan_interval_minutes || ' minutes')::INTERVAL;

    -- Update goal_sessions to schedule next scan
    UPDATE goal_sessions
    SET
      status = 'scanning',
      next_scan_time = v_next_scan_time,
      last_scan_time = NOW()
    WHERE id = NEW.session_id
      AND status IN ('trade_pending', 'awaiting_continuation', 'active'); -- Include 'active' status

    -- Log for debugging
    RAISE NOTICE 'Scheduled immediate rescan for session % at % (1 minute after abandonment)', NEW.session_id, v_next_scan_time;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate trigger to pick up function changes
DROP TRIGGER IF EXISTS trigger_schedule_scan_after_intent_timeout ON entry_intents;
CREATE TRIGGER trigger_schedule_scan_after_intent_timeout
  AFTER UPDATE OF status ON entry_intents
  FOR EACH ROW
  WHEN (NEW.status = 'timeout')
  EXECUTE FUNCTION schedule_next_scan_after_intent_expiration();

-- Add comment explaining the immediate restart behavior
COMMENT ON FUNCTION schedule_next_scan_after_intent_expiration() IS
  'Schedules immediate scan restart (1 minute) after intent abandonment. This allows Alpha to quickly pivot to new opportunities instead of waiting 15 minutes. The 1 minute cooldown prevents thrashing while still being responsive.';

-- Grant permissions
GRANT EXECUTE ON FUNCTION schedule_next_scan_after_intent_expiration TO authenticated, service_role;
