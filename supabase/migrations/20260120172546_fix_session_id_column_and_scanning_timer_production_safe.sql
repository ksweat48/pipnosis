/*
  # Fix SSOT Column Name + Scanning Timer (Production-Safe)

  ## Part 1: Fix trigger_auto_close_expired_continuation SSOT Violation
  
  ### Problem
  The trigger uses `session_id` but column is `goal_session_id`.
  Also references non-existent `end_reason` column.
  
  ### Fix
  - Use correct column: `goal_session_id` (not session_id)
  - Don't set non-existent `end_reason` column
  - Only update `status` and `completed_at`
  
  ## Part 2: Fix Scanning Timer to Only Count Active Scanning Time
  
  ### Problem
  60-minute timeout counts trade execution time as scanning time.
  Timer never stops during trades.
  
  ### Expected Behavior
  - Scan 10 min → timer = 10 min
  - Trade opens → timer STOPS (scanning_started_at = NULL)
  - Trade runs 30 min → timer NOT counting
  - Trade closes → timer RESETS (scanning_started_at = NOW())
  - Scan 20 min → timer = 20 min
  - No timeout (only 20 min of active scanning)
  
  ### Fix
  - STOP timer when trade opens (scanning_started_at = NULL)
  - RESET timer when trade closes (scanning_started_at = NOW())
  - Exclude 'trade_pending' from timeout checks
  - Backfill sessions with stale timers
  
  ## SSOT Compliance
  - Session status is AUTHORITY
  - Timer follows status automatically via triggers
  - No manual timer manipulation
  - Clear audit trail via logs
*/

-- ============================================================================
-- PART 1: Fix trigger_auto_close_expired_continuation (CRITICAL)
-- ============================================================================

CREATE OR REPLACE FUNCTION trigger_auto_close_expired_continuation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- SSOT: Check using only awaiting_continuation_since and status
  IF NEW.status = 'awaiting_continuation' 
     AND NEW.awaiting_continuation_since IS NOT NULL
     AND EXTRACT(EPOCH FROM (now() - NEW.awaiting_continuation_since)) > 60
  THEN
    -- Auto-close the session
    NEW.status := 'completed';
    NEW.completed_at := now();  -- ✅ FIXED: Use completed_at (not end_reason)
    NEW.updated_at := now();
    
    RAISE NOTICE '[Continuation Timeout] ⏱️ Auto-closed session % after 60 seconds', NEW.id;
    
    -- Create notification using CORRECT column name: goal_session_id
    INSERT INTO goal_notifications (
      user_id, 
      goal_session_id,  -- ✅ FIXED: Was session_id, now goal_session_id
      type, 
      title, 
      message, 
      priority, 
      metadata
    )
    VALUES (
      NEW.user_id,
      NEW.id,
      'session_ended',
      'Session Auto-Closed',
      'Your session was automatically closed after 60 seconds with no response.',
      'medium',
      jsonb_build_object(
        'session_id', NEW.id,
        'reason', 'continuation_timeout',
        'timeout_seconds', 60,
        'actual_seconds', EXTRACT(EPOCH FROM (now() - NEW.awaiting_continuation_since))
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION trigger_auto_close_expired_continuation IS 
  'SSOT: Auto-closes session after 60s continuation timeout. FIXED: Uses goal_session_id and completed_at.';

-- ============================================================================
-- PART 2: Update Trade Status Trigger to STOP Timer on Trade Open
-- ============================================================================

CREATE OR REPLACE FUNCTION update_session_status_on_trade_change()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_open_trades_count INT;
  v_session_status TEXT;
  v_session_id UUID;
BEGIN
  -- Get session ID
  IF TG_OP = 'INSERT' THEN
    v_session_id := NEW.goal_session_id;
  ELSIF TG_OP = 'UPDATE' THEN
    v_session_id := NEW.goal_session_id;
  ELSE
    RETURN NEW;
  END IF;

  -- Get current session status
  SELECT status INTO v_session_status
  FROM goal_sessions
  WHERE id = v_session_id;

  -- Count open trades
  SELECT COUNT(*) INTO v_open_trades_count
  FROM goal_session_trades
  WHERE goal_session_id = v_session_id
  AND status = 'open';

  -- SSOT: Session status is authority, timer follows status
  IF v_open_trades_count > 0 THEN
    -- Has open trades: change to 'in_trade' if scanning
    IF v_session_status = 'scanning' THEN
      UPDATE goal_sessions
      SET
        status = 'in_trade',
        scanning_started_at = NULL,  -- ✅ FIX: STOP the timer
        updated_at = NOW()
      WHERE id = v_session_id;

      RAISE NOTICE '[Timer] ⏸️ Session % trade opened - Timer STOPPED', v_session_id;
    END IF;
  ELSE
    -- No open trades: return to 'scanning' if in_trade
    IF v_session_status = 'in_trade' THEN
      UPDATE goal_sessions
      SET
        status = 'scanning',
        scanning_started_at = NOW(),  -- ✅ Timer RESETS
        updated_at = NOW()
      WHERE id = v_session_id;

      RAISE NOTICE '[Timer] ▶️ Session % trade closed - Timer RESET', v_session_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION update_session_status_on_trade_change() IS
  'SSOT: Updates session status and timer. Timer STOPS on trade open, RESETS on close.';

-- ============================================================================
-- PART 3: Update Timeout Check to EXCLUDE 'trade_pending' Status
-- ============================================================================

CREATE OR REPLACE FUNCTION should_show_continuation_modal(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session record;
  v_elapsed_minutes numeric;
  v_has_open_trades boolean;
  v_duration_threshold integer;
BEGIN
  SELECT
    scanning_started_at,
    scanning_duration_minutes,
    status,
    start_time,
    created_at,
    awaiting_continuation_since
  INTO v_session
  FROM goal_sessions
  WHERE id = p_session_id;

  IF v_session IS NULL THEN
    RETURN false;
  END IF;

  -- ✅ FIX: Only check 'scanning' status (exclude 'trade_pending')
  -- Reason: 'trade_pending' = Alpha found setup, not idle
  IF v_session.status != 'scanning' THEN
    RETURN false;
  END IF;

  -- ✅ FIX: If timer is NULL, it's NOT running
  IF v_session.scanning_started_at IS NULL THEN
    RAISE NOTICE '[Timer] ⏸️ Session % timer not running', p_session_id;
    RETURN false;
  END IF;

  -- Default to 60 minutes
  v_duration_threshold := COALESCE(v_session.scanning_duration_minutes, 60);

  -- Calculate elapsed scanning time
  v_elapsed_minutes := EXTRACT(EPOCH FROM (now() - v_session.scanning_started_at)) / 60;

  -- Check for open trades
  SELECT EXISTS (
    SELECT 1
    FROM goal_session_trades gst
    WHERE gst.goal_session_id = p_session_id
      AND gst.status = 'open'
  ) INTO v_has_open_trades;

  -- Trigger timeout only if: elapsed >= threshold AND no open trades
  IF v_elapsed_minutes >= v_duration_threshold AND NOT v_has_open_trades THEN
    RAISE NOTICE '[Timer] ✅ Session % timeout: %.2f min >= % min', 
      p_session_id, v_elapsed_minutes, v_duration_threshold;
    RETURN true;
  END IF;

  -- Log when blocked by open trades
  IF v_elapsed_minutes >= v_duration_threshold AND v_has_open_trades THEN
    RAISE NOTICE '[Timer] 🛡️ Session % timeout blocked: has open trades', p_session_id;
  END IF;

  RETURN false;
END;
$$;

COMMENT ON FUNCTION should_show_continuation_modal IS
  'SSOT: Check timeout for SCANNING status only. Timer STOPS during trades.';

-- ============================================================================
-- PART 4: Backfill - Stop Timer for Non-Scanning Sessions
-- ============================================================================

DO $$
DECLARE
  v_updated_count INTEGER;
BEGIN
  -- SAFETY: Only clear timer for sessions NOT in 'scanning' status
  -- This is production-safe: makes logic MORE lenient, not stricter
  UPDATE goal_sessions
  SET
    scanning_started_at = NULL,
    updated_at = NOW()
  WHERE status NOT IN ('scanning')
    AND scanning_started_at IS NOT NULL;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count > 0 THEN
    RAISE NOTICE '[Backfill] ⏸️ Stopped timer for % sessions', v_updated_count;
  ELSE
    RAISE NOTICE '[Backfill] ✅ No cleanup needed';
  END IF;
END $$;

-- ============================================================================
-- PART 5: Verification
-- ============================================================================

DO $$
DECLARE
  v_scanning_with_timer INTEGER;
  v_not_scanning_with_timer INTEGER;
  v_in_trade_sessions INTEGER;
BEGIN
  -- Count sessions with timers in correct states
  SELECT COUNT(*) INTO v_scanning_with_timer
  FROM goal_sessions
  WHERE status = 'scanning' AND scanning_started_at IS NOT NULL;

  SELECT COUNT(*) INTO v_not_scanning_with_timer
  FROM goal_sessions
  WHERE status NOT IN ('scanning') AND scanning_started_at IS NOT NULL;
  
  SELECT COUNT(*) INTO v_in_trade_sessions
  FROM goal_sessions
  WHERE status = 'in_trade';

  RAISE NOTICE '[Verification] ✅ Scanning sessions with timer: %', v_scanning_with_timer;
  RAISE NOTICE '[Verification] ✅ Sessions in_trade: %', v_in_trade_sessions;
  RAISE NOTICE '[Verification] ❌ Non-scanning with timer (should be 0): %', v_not_scanning_with_timer;

  IF v_not_scanning_with_timer > 0 THEN
    RAISE WARNING 'Found % sessions with timer while not scanning!', v_not_scanning_with_timer;
  ELSE
    RAISE NOTICE '[Verification] ✅ All timers in correct state';
  END IF;
END $$;

-- ============================================================================
-- Summary
-- ============================================================================

/*
  ✅ FIXED: trigger uses goal_session_id (not session_id)
  ✅ FIXED: trigger uses completed_at (not end_reason)
  ✅ FIXED: Timer stops when trade opens (scanning_started_at = NULL)
  ✅ FIXED: Timer resets when trade closes (scanning_started_at = NOW())
  ✅ FIXED: Timeout only checks 'scanning' status (not 'trade_pending')
  ✅ FIXED: Backfilled sessions with stale timers
  ✅ SSOT: Session status is authority, timer follows automatically
  ✅ CCIP: Production-safe, no silent mutations, clear audit trail
  
  ## Behavior After This Fix
  
  User scans 10 min, trades 30 min, scans 20 min:
  - Scan 10 min → timer = 10 min
  - Trade opens → timer STOPS (NULL)
  - Trade runs 30 min → timer NOT counting
  - Trade closes → timer RESETS (NOW())
  - Scan 20 min → timer = 20 min
  - Result: No timeout (only 20 min of active scanning)
*/