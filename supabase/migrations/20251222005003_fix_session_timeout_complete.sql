/*
  # Complete Session Timeout Enforcement Fix

  ## Problem Statement
  Sessions get stuck showing "Scanning" status but scanning has actually stopped.
  The 15-minute timeout doesn't trigger the modal, and sessions never close.

  ## Root Causes
  1. scanning_started_at field may be NULL - modal never triggers
  2. scanning_duration_minutes may be NULL - defaults aren't applied
  3. Server-side check may not run - no client-side fallback
  4. Sessions in 'awaiting_continuation' stay forever if 1-min timeout fails

  ## Fixes Applied
  1. Backfill ALL active sessions with proper scanning_started_at
  2. Ensure scanning_duration_minutes defaults to 15
  3. Fix should_show_continuation_modal to handle edge cases
  4. Add hard safety net: auto-close any session >20 min without trade
  5. Improve check_continuation_modal_timeout to be more aggressive
  6. Add trigger to auto-initialize scanning fields on session start

  ## Security
  - All functions use SECURITY DEFINER
  - RLS policies remain intact
  - No data deletion, only status updates
*/

-- ============================================================================
-- STEP 1: Emergency Fix - Backfill scanning_started_at for ALL active sessions
-- ============================================================================

DO $$
DECLARE
  v_fixed_count integer;
BEGIN
  -- Fix sessions missing scanning_started_at
  WITH fixed AS (
    UPDATE goal_sessions
    SET
      scanning_started_at = COALESCE(scanning_started_at, start_time, created_at),
      scanning_duration_minutes = COALESCE(scanning_duration_minutes, 15),
      updated_at = now()
    WHERE status IN ('scanning', 'trade_pending', 'in_trade', 'soft_closing', 'initializing', 'awaiting_continuation')
      AND (scanning_started_at IS NULL OR scanning_duration_minutes IS NULL)
    RETURNING id
  )
  SELECT COUNT(*) INTO v_fixed_count FROM fixed;
  
  IF v_fixed_count > 0 THEN
    RAISE NOTICE '[Session Fix] Backfilled scanning fields for % sessions', v_fixed_count;
  END IF;
END $$;

-- ============================================================================
-- STEP 2: Emergency Close - Sessions stuck in awaiting_continuation
-- ============================================================================

DO $$
DECLARE
  v_closed_count integer;
BEGIN
  -- Close sessions where modal timeout has expired
  WITH closed AS (
    UPDATE goal_sessions
    SET
      status = 'user_stopped',
      end_time = now(),
      awaiting_continuation_confirmation = false,
      continuation_confirmation_expires_at = NULL,
      updated_at = now()
    WHERE status = 'awaiting_continuation'
      AND continuation_confirmation_expires_at IS NOT NULL
      AND now() > continuation_confirmation_expires_at
    RETURNING id
  )
  SELECT COUNT(*) INTO v_closed_count FROM closed;
  
  IF v_closed_count > 0 THEN
    RAISE NOTICE '[Emergency Close] Closed % sessions with expired continuation timeout', v_closed_count;
  END IF;
END $$;

-- ============================================================================
-- STEP 3: Safety Net - Close ANY session scanning >20 minutes without trades
-- ============================================================================

DO $$
DECLARE
  v_closed_count integer;
BEGIN
  WITH closed AS (
    UPDATE goal_sessions
    SET
      status = 'user_stopped',
      end_time = now(),
      awaiting_continuation_confirmation = false,
      continuation_confirmation_expires_at = NULL,
      updated_at = now()
    WHERE status IN ('scanning', 'trade_pending')
      AND scanning_started_at IS NOT NULL
      AND EXTRACT(EPOCH FROM (now() - scanning_started_at)) / 60 > 20
      AND NOT EXISTS (
        SELECT 1 FROM goal_session_trades gst
        WHERE gst.goal_session_id = goal_sessions.id
          AND gst.created_at >= goal_sessions.scanning_started_at
      )
    RETURNING id
  )
  SELECT COUNT(*) INTO v_closed_count FROM closed;
  
  IF v_closed_count > 0 THEN
    RAISE NOTICE '[Safety Net] Closed % sessions scanning >20min without trades', v_closed_count;
  END IF;
END $$;

-- ============================================================================
-- STEP 4: Fix should_show_continuation_modal - More robust detection
-- ============================================================================

CREATE OR REPLACE FUNCTION should_show_continuation_modal(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session record;
  v_elapsed_minutes numeric;
  v_has_recent_trades boolean;
  v_duration_threshold integer;
BEGIN
  SELECT
    scanning_started_at,
    scanning_duration_minutes,
    awaiting_continuation_confirmation,
    status,
    start_time,
    created_at
  INTO v_session
  FROM goal_sessions
  WHERE id = p_session_id;

  -- Session not found
  IF v_session IS NULL THEN
    RETURN false;
  END IF;

  -- Only check sessions in active scanning states
  IF v_session.status NOT IN ('scanning', 'trade_pending') THEN
    RETURN false;
  END IF;

  -- Already showing modal
  IF v_session.awaiting_continuation_confirmation THEN
    RETURN false;
  END IF;

  -- CRITICAL: Default scanning_started_at if not set
  -- Use start_time or created_at as fallback
  IF v_session.scanning_started_at IS NULL THEN
    v_session.scanning_started_at := COALESCE(v_session.start_time, v_session.created_at);
  END IF;

  -- CRITICAL: Default duration threshold to 15 minutes
  v_duration_threshold := COALESCE(v_session.scanning_duration_minutes, 15);

  -- Calculate elapsed minutes
  v_elapsed_minutes := EXTRACT(EPOCH FROM (now() - v_session.scanning_started_at)) / 60;

  -- Check if any trades were found during this scanning period
  SELECT EXISTS (
    SELECT 1
    FROM goal_session_trades gst
    WHERE gst.goal_session_id = p_session_id
      AND gst.created_at >= v_session.scanning_started_at
  ) INTO v_has_recent_trades;

  -- Show modal if: elapsed >= threshold AND no trades found
  IF v_elapsed_minutes >= v_duration_threshold AND NOT v_has_recent_trades THEN
    RAISE NOTICE '[should_show_continuation_modal] Session % elapsed=% threshold=% -> TRUE',
      p_session_id, v_elapsed_minutes, v_duration_threshold;
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

COMMENT ON FUNCTION should_show_continuation_modal IS
  'Returns true if session has been scanning for 15+ minutes without finding a trade. Handles NULL scanning_started_at gracefully.';

-- ============================================================================
-- STEP 5: Fix check_continuation_modal_timeout - More aggressive timeout
-- ============================================================================

CREATE OR REPLACE FUNCTION check_continuation_modal_timeout(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session record;
  v_timed_out boolean := false;
BEGIN
  SELECT
    awaiting_continuation_confirmation,
    continuation_confirmation_expires_at,
    status,
    scanning_started_at
  INTO v_session
  FROM goal_sessions
  WHERE id = p_session_id;

  IF v_session IS NULL THEN
    RETURN false;
  END IF;

  -- Check #1: Standard timeout (awaiting_continuation with expired timestamp)
  IF v_session.awaiting_continuation_confirmation
     AND v_session.continuation_confirmation_expires_at IS NOT NULL
     AND now() > v_session.continuation_confirmation_expires_at
     AND v_session.status IN ('awaiting_continuation', 'scanning', 'trade_pending')
  THEN
    RAISE NOTICE '[check_continuation_modal_timeout] Session % timed out - auto-closing', p_session_id;
    
    UPDATE goal_sessions
    SET
      status = 'user_stopped',
      awaiting_continuation_confirmation = false,
      continuation_confirmation_expires_at = NULL,
      end_time = now(),
      updated_at = now()
    WHERE id = p_session_id;

    v_timed_out := true;
  END IF;

  -- Check #2: Safety net - session scanning >20 min without trade and no modal
  IF NOT v_timed_out
     AND v_session.status IN ('scanning', 'trade_pending')
     AND v_session.scanning_started_at IS NOT NULL
     AND NOT v_session.awaiting_continuation_confirmation
     AND EXTRACT(EPOCH FROM (now() - v_session.scanning_started_at)) / 60 > 20
  THEN
    -- Check if any trades found
    IF NOT EXISTS (
      SELECT 1 FROM goal_session_trades gst
      WHERE gst.goal_session_id = p_session_id
        AND gst.created_at >= v_session.scanning_started_at
    ) THEN
      RAISE NOTICE '[check_continuation_modal_timeout] Session % safety net triggered - scanning >20min', p_session_id;
      
      UPDATE goal_sessions
      SET
        status = 'user_stopped',
        awaiting_continuation_confirmation = false,
        continuation_confirmation_expires_at = NULL,
        end_time = now(),
        updated_at = now()
      WHERE id = p_session_id;

      v_timed_out := true;
    END IF;
  END IF;

  RETURN v_timed_out;
END;
$$;

COMMENT ON FUNCTION check_continuation_modal_timeout IS
  'Checks if continuation modal has timed out (1 minute) and auto-closes session. Also includes 20-minute safety net for stuck sessions.';

-- ============================================================================
-- STEP 6: Create trigger to auto-initialize scanning fields on status change
-- ============================================================================

CREATE OR REPLACE FUNCTION auto_initialize_scanning_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- When session enters scanning status, ensure fields are set
  IF NEW.status = 'scanning' AND (OLD.status IS NULL OR OLD.status != 'scanning') THEN
    -- Only set if not already set
    IF NEW.scanning_started_at IS NULL THEN
      NEW.scanning_started_at := now();
    END IF;
    IF NEW.scanning_duration_minutes IS NULL THEN
      NEW.scanning_duration_minutes := 15;
    END IF;
  END IF;
  
  -- When user continues scanning (status changes from awaiting_continuation to scanning)
  IF NEW.status = 'scanning' AND OLD.status = 'awaiting_continuation' THEN
    NEW.scanning_started_at := now();
    NEW.awaiting_continuation_confirmation := false;
    NEW.continuation_confirmation_expires_at := NULL;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Drop existing trigger if exists and recreate
DROP TRIGGER IF EXISTS trigger_auto_init_scanning_fields ON goal_sessions;

CREATE TRIGGER trigger_auto_init_scanning_fields
  BEFORE UPDATE ON goal_sessions
  FOR EACH ROW
  EXECUTE FUNCTION auto_initialize_scanning_fields();

COMMENT ON TRIGGER trigger_auto_init_scanning_fields ON goal_sessions IS
  'Automatically initializes scanning_started_at and scanning_duration_minutes when session enters scanning state';

-- ============================================================================
-- STEP 7: Create client-callable function to force close stale sessions
-- ============================================================================

CREATE OR REPLACE FUNCTION force_close_stale_session(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session record;
BEGIN
  -- Get session and verify ownership
  SELECT id, user_id, status, scanning_started_at
  INTO v_session
  FROM goal_sessions
  WHERE id = p_session_id
    AND user_id = auth.uid();

  IF v_session IS NULL THEN
    RETURN false;
  END IF;

  -- Only close if in an active status
  IF v_session.status NOT IN ('scanning', 'trade_pending', 'awaiting_continuation', 'initializing') THEN
    RETURN false;
  END IF;

  -- Force close the session
  UPDATE goal_sessions
  SET
    status = 'user_stopped',
    end_time = now(),
    awaiting_continuation_confirmation = false,
    continuation_confirmation_expires_at = NULL,
    updated_at = now()
  WHERE id = p_session_id;

  RAISE NOTICE '[force_close_stale_session] Session % force closed by user', p_session_id;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION force_close_stale_session IS
  'Allows users to force-close their own stale sessions as a client-side fallback';

GRANT EXECUTE ON FUNCTION force_close_stale_session TO authenticated;

-- ============================================================================
-- STEP 8: Create function for client-side 15-min check
-- ============================================================================

CREATE OR REPLACE FUNCTION client_trigger_continuation_modal(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_should_show boolean;
  v_session record;
BEGIN
  -- Verify ownership
  SELECT id, user_id, status FROM goal_sessions
  WHERE id = p_session_id AND user_id = auth.uid()
  INTO v_session;

  IF v_session IS NULL THEN
    RETURN false;
  END IF;

  -- Check if should show modal
  v_should_show := should_show_continuation_modal(p_session_id);

  IF v_should_show THEN
    -- Trigger the modal
    PERFORM trigger_continuation_modal(p_session_id);
    RAISE NOTICE '[client_trigger_continuation_modal] Client triggered modal for session %', p_session_id;
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

COMMENT ON FUNCTION client_trigger_continuation_modal IS
  'Client-side callable function to trigger continuation modal if 15-min threshold reached';

GRANT EXECUTE ON FUNCTION client_trigger_continuation_modal TO authenticated;

-- ============================================================================
-- STEP 9: Grant permissions
-- ============================================================================

GRANT EXECUTE ON FUNCTION should_show_continuation_modal TO authenticated;
GRANT EXECUTE ON FUNCTION should_show_continuation_modal TO service_role;
GRANT EXECUTE ON FUNCTION check_continuation_modal_timeout TO authenticated;
GRANT EXECUTE ON FUNCTION check_continuation_modal_timeout TO service_role;
GRANT EXECUTE ON FUNCTION auto_initialize_scanning_fields TO service_role;
