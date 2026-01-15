/*
  # Fix Session Timeout Logic to Check for Open Trades

  1. Problem
    - Sessions with open trades were auto-closing after 60 minutes
    - Function checked if trades were created DURING current scanning cycle
    - But ignored trades that were opened BEFORE scanning_started_at
    - Result: Active trades were orphaned when session auto-closed

  2. Solution
    - Change logic to check for ANY currently open trades
    - Remove created_at filter - we only care about trade status
    - Sessions with ANY open trade will NEVER trigger timeout modal
    - Prevents orphaning trades regardless of when they were created

  3. Security
    - Maintains SECURITY DEFINER for proper RLS handling
    - No changes to permissions or policies needed

  4. Additional Safety
    - Add open trades check to modal timeout auto-close function
    - Prevents session close even if modal timeout logic fails
    - Double safety net against orphaning trades
*/

-- ============================================================================
-- FIX: should_show_continuation_modal - Check for ANY open trades
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

  -- CRITICAL: Default duration threshold to 60 minutes
  v_duration_threshold := COALESCE(v_session.scanning_duration_minutes, 60);

  -- Calculate elapsed minutes
  v_elapsed_minutes := EXTRACT(EPOCH FROM (now() - v_session.scanning_started_at)) / 60;

  -- CRITICAL FIX: Check for ANY currently OPEN trades (regardless of creation time)
  -- Previous logic only checked trades created during current scanning cycle
  -- This caused sessions with pre-existing open trades to timeout incorrectly
  SELECT EXISTS (
    SELECT 1
    FROM goal_session_trades gst
    WHERE gst.goal_session_id = p_session_id
      AND gst.status = 'open'  -- Only check if trade is currently OPEN
      -- REMOVED: AND gst.created_at >= v_session.scanning_started_at
      -- We don't care WHEN the trade was created, only that it's OPEN
  ) INTO v_has_open_trades;

  -- Show modal only if: elapsed >= threshold AND no open trades
  -- Never trigger timeout while trades are open
  IF v_elapsed_minutes >= v_duration_threshold AND NOT v_has_open_trades THEN
    RAISE NOTICE '[should_show_continuation_modal] Session % elapsed=%.2f minutes, threshold=% minutes, no open trades -> TRIGGERING MODAL',
      p_session_id, v_elapsed_minutes, v_duration_threshold;
    RETURN true;
  END IF;

  -- Log when timeout is blocked by open trades
  IF v_elapsed_minutes >= v_duration_threshold AND v_has_open_trades THEN
    RAISE NOTICE '[should_show_continuation_modal] Session % elapsed=%.2f minutes BUT has open trades -> BLOCKED',
      p_session_id, v_elapsed_minutes;
  END IF;

  RETURN false;
END;
$$;

COMMENT ON FUNCTION should_show_continuation_modal IS
  'Returns true if session has been scanning for 60+ minutes without open trades. Checks for ANY currently open trade regardless of creation time to prevent orphaning positions.';

-- ============================================================================
-- SAFETY NET: Add open trades check to modal timeout auto-close
-- ============================================================================

CREATE OR REPLACE FUNCTION check_continuation_modal_timeout(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session record;
  v_modal_elapsed_minutes numeric;
  v_has_open_trades boolean;
BEGIN
  SELECT
    awaiting_continuation_confirmation,
    awaiting_continuation_since,
    status
  INTO v_session
  FROM goal_sessions
  WHERE id = p_session_id;

  -- Not applicable
  IF v_session IS NULL OR NOT v_session.awaiting_continuation_confirmation THEN
    RETURN false;
  END IF;

  -- Calculate time since modal was shown
  IF v_session.awaiting_continuation_since IS NULL THEN
    -- No timestamp recorded, assume not timed out
    RETURN false;
  END IF;

  v_modal_elapsed_minutes := EXTRACT(EPOCH FROM (now() - v_session.awaiting_continuation_since)) / 60;

  -- CRITICAL SAFETY CHECK: Never auto-close if there are open trades
  -- This is a safety net in case the modal was triggered incorrectly
  SELECT EXISTS (
    SELECT 1
    FROM goal_session_trades gst
    WHERE gst.goal_session_id = p_session_id
      AND gst.status = 'open'
  ) INTO v_has_open_trades;

  IF v_has_open_trades THEN
    RAISE WARNING '[check_continuation_modal_timeout] Session % has open trades - BLOCKING auto-close despite modal timeout', p_session_id;

    -- Clear the modal state since it shouldn't have been triggered
    UPDATE goal_sessions
    SET
      awaiting_continuation_confirmation = false,
      awaiting_continuation_since = NULL,
      status = 'trade_pending'  -- Set to trade_pending since we have open trades
    WHERE id = p_session_id;

    RETURN false;
  END IF;

  -- Check if 1 minute has elapsed since modal was shown
  IF v_modal_elapsed_minutes >= 1 THEN
    RAISE NOTICE '[check_continuation_modal_timeout] Session % modal timeout (%.2f minutes) - auto-closing session',
      p_session_id, v_modal_elapsed_minutes;

    -- Auto-close the session
    UPDATE goal_sessions
    SET
      status = 'completed',
      completed_at = now(),
      close_reason = 'timeout_no_response',
      awaiting_continuation_confirmation = false
    WHERE id = p_session_id
      AND status != 'completed';  -- Safety check: don't update if already completed

    RETURN true;
  END IF;

  RETURN false;
END;
$$;

COMMENT ON FUNCTION check_continuation_modal_timeout IS
  'Checks if continuation modal has timed out after 1 minute. NEVER auto-closes sessions with open trades (safety net against orphaning positions).';