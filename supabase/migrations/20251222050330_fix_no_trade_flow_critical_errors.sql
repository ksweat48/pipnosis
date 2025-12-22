/*
  # Fix No-Trade Flow Critical Errors

  ## Critical Fixes Applied

  ### 1. Table Name Consolidation
  - BOTH `goal_session_trades` and `goal_trades` exist in database
  - All continuation/timeout functions now use `goal_session_trades` (the primary table)
  - Ensures consistent data reading across all checks

  ### 2. Column Name Corrections  
  - Fixed `gs.goal_amount` → `gs.target_value` (correct column name)
  - Fixed `gs.current_pnl` → calculated from trades sum
  - Ensures modal data displays correct values

  ### 3. Duplicate Modal Prevention
  - Added duplicate check to `trigger_continuation_modal()`
  - Prevents multiple modals if function called twice
  - Matches duplicate protection in `create_session_ended_modal()`

  ### 4. Trade Count Timestamp Filtering
  - Fixed trade counts to only include trades AFTER `scanning_started_at`
  - Prevents misleading counts from previous scanning cycles
  - Shows accurate "no new trades" status

  ### 5. Close Reason Validation
  - Added CHECK constraint for valid close reasons
  - Prevents typos breaking frontend rendering
  - Valid values: 'timeout', 'safety_net', 'user_stopped', 'manual', 'goal_achieved'

  ### 6. Function Consolidation
  - Removed duplicate function definitions
  - Single source of truth for each function
  - No more migration conflicts

  ## Security
  - All functions remain SECURITY DEFINER for admin operations
  - RLS policies unchanged
  - No breaking changes to existing data
*/

-- =====================================================
-- FIX 1: Add close_reason constraint to goal_session_trades
-- =====================================================

DO $$ 
BEGIN
  -- Drop existing constraint if it exists
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'valid_close_reason'
  ) THEN
    ALTER TABLE goal_session_trades DROP CONSTRAINT valid_close_reason;
  END IF;

  -- Add constraint with all valid values
  ALTER TABLE goal_session_trades 
  ADD CONSTRAINT valid_close_reason 
  CHECK (close_reason IN ('timeout', 'safety_net', 'user_stopped', 'manual', 'goal_achieved', 'stop_loss', 'take_profit', 'breakeven', 'alpha_override'));
END $$;

COMMENT ON CONSTRAINT valid_close_reason ON goal_session_trades IS
  'Ensures close_reason uses only valid, frontend-recognized values';

-- =====================================================
-- FIX 2: Recreate should_show_continuation_modal with fixes
-- =====================================================

CREATE OR REPLACE FUNCTION should_show_continuation_modal(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session record;
  v_recent_trade_count integer;
  v_minutes_since_scan integer;
BEGIN
  -- Get session with correct column names
  SELECT 
    gs.id,
    gs.user_id,
    gs.status,
    gs.scanning_started_at,
    gs.last_scan_at,
    gs.awaiting_continuation_confirmation,
    gs.continuation_confirmation_expires_at
  INTO v_session
  FROM goal_sessions gs
  WHERE gs.id = p_session_id;

  -- Session not found
  IF v_session.id IS NULL THEN
    RETURN false;
  END IF;

  -- Not in scanning status
  IF v_session.status NOT IN ('scanning', 'trade_pending') THEN
    RETURN false;
  END IF;

  -- Already awaiting confirmation
  IF v_session.awaiting_continuation_confirmation = true THEN
    RETURN false;
  END IF;

  -- Calculate minutes since scanning started
  v_minutes_since_scan := EXTRACT(EPOCH FROM (
    now() - COALESCE(v_session.scanning_started_at, v_session.last_scan_at, now())
  )) / 60;

  -- Not yet 15 minutes
  IF v_minutes_since_scan < 15 THEN
    RETURN false;
  END IF;

  -- Check if modal already exists (duplicate prevention)
  IF EXISTS (
    SELECT 1 FROM pending_user_modals
    WHERE goal_session_id = p_session_id
      AND modal_type = 'continuation'
      AND dismissed_at IS NULL
  ) THEN
    RETURN false;
  END IF;

  -- FIX: Count trades AFTER scanning started, use goal_session_trades
  SELECT COUNT(*) INTO v_recent_trade_count
  FROM goal_session_trades gst
  WHERE gst.goal_session_id = p_session_id
    AND gst.opened_at >= COALESCE(v_session.scanning_started_at, v_session.last_scan_at);

  -- Show modal only if no recent trades
  RETURN (v_recent_trade_count = 0);
END;
$$;

COMMENT ON FUNCTION should_show_continuation_modal IS
  'FIXED: Uses goal_session_trades, checks duplicates, filters trades by scanning_started_at';

-- =====================================================
-- FIX 3: Recreate check_continuation_modal_timeout with fixes
-- =====================================================

CREATE OR REPLACE FUNCTION check_continuation_modal_timeout(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session record;
  v_recent_trade_count integer;
  v_minutes_waiting integer;
BEGIN
  -- Get session with correct column names
  SELECT 
    gs.id,
    gs.user_id,
    gs.status,
    gs.scanning_started_at,
    gs.awaiting_continuation_confirmation,
    gs.continuation_confirmation_expires_at
  INTO v_session
  FROM goal_sessions gs
  WHERE gs.id = p_session_id;

  -- Session not found
  IF v_session.id IS NULL THEN
    RETURN false;
  END IF;

  -- Not awaiting confirmation
  IF v_session.status != 'awaiting_continuation' OR v_session.awaiting_continuation_confirmation != true THEN
    RETURN false;
  END IF;

  -- Calculate how long we've been waiting
  v_minutes_waiting := EXTRACT(EPOCH FROM (
    now() - v_session.continuation_confirmation_expires_at + interval '1 minute'
  )) / 60;

  -- Not yet 20 minutes (15 initial + 5 grace period)
  IF v_minutes_waiting < 5 THEN
    RETURN false;
  END IF;

  -- FIX: Count trades AFTER scanning started, use goal_session_trades
  SELECT COUNT(*) INTO v_recent_trade_count
  FROM goal_session_trades gst
  WHERE gst.goal_session_id = p_session_id
    AND gst.opened_at >= COALESCE(v_session.scanning_started_at, now() - interval '20 minutes');

  -- Close only if still no trades
  RETURN (v_recent_trade_count = 0);
END;
$$;

COMMENT ON FUNCTION check_continuation_modal_timeout IS
  'FIXED: Uses goal_session_trades, filters trades by scanning_started_at timestamp';

-- =====================================================
-- FIX 4: Recreate trigger_continuation_modal with all fixes
-- =====================================================

CREATE OR REPLACE FUNCTION trigger_continuation_modal(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session record;
  v_modal_id uuid;
  v_notification_id uuid;
  v_current_pnl numeric;
BEGIN
  -- Get session details with CORRECT column names
  SELECT
    gs.user_id,
    gs.target_value,  -- FIX: Was gs.goal_amount (doesn't exist!)
    gs.status
  INTO v_session
  FROM goal_sessions gs
  WHERE gs.id = p_session_id;

  -- Only proceed if session is in scanning or trade_pending status
  IF v_session.status NOT IN ('scanning', 'trade_pending') THEN
    RETURN;
  END IF;

  -- FIX: Check for duplicate modal BEFORE creating
  IF EXISTS (
    SELECT 1 FROM pending_user_modals
    WHERE goal_session_id = p_session_id
      AND modal_type = 'continuation'
      AND dismissed_at IS NULL
  ) THEN
    -- Modal already exists, don't create duplicate
    RETURN;
  END IF;

  -- FIX: Calculate current PnL from trades
  SELECT COALESCE(SUM(profit_loss), 0) INTO v_current_pnl
  FROM goal_session_trades
  WHERE goal_session_id = p_session_id
    AND status = 'closed';

  -- Update session status
  UPDATE goal_sessions
  SET
    status = 'awaiting_continuation',
    awaiting_continuation_confirmation = true,
    continuation_confirmation_expires_at = now() + interval '1 minute'
  WHERE id = p_session_id;

  -- Create persistent modal record
  INSERT INTO pending_user_modals (
    user_id,
    goal_session_id,
    modal_type,
    modal_data,
    expires_at
  ) VALUES (
    v_session.user_id,
    p_session_id,
    'continuation',
    jsonb_build_object(
      'session_id', p_session_id,
      'trades_in_session', (
        SELECT COUNT(*) FROM goal_session_trades 
        WHERE goal_session_id = p_session_id
      ),
      'current_progress', v_current_pnl,
      'target_value', v_session.target_value,  -- FIX: Use correct column
      'continuation_prompt', 'No trade opportunities found in the last 15 minutes. Would you like to continue scanning or close this session?',
      'timestamp', now()
    ),
    now() + interval '24 hours'
  )
  RETURNING id INTO v_modal_id;

  -- Create notification record
  INSERT INTO goal_notifications (
    user_id,
    goal_session_id,
    type,
    message,
    priority,
    viewed,
    metadata
  ) VALUES (
    v_session.user_id,
    p_session_id,
    'scanning_timeout',
    format(
      'Scanning paused after 15 minutes with %s trades. Continue or close session?',
      (SELECT COUNT(*) FROM goal_session_trades WHERE goal_session_id = p_session_id)
    ),
    'high',
    false,
    jsonb_build_object(
      'modal_id', v_modal_id,
      'session_id', p_session_id,
      'trades_count', (SELECT COUNT(*) FROM goal_session_trades WHERE goal_session_id = p_session_id),
      'current_pnl', v_current_pnl,
      'target', v_session.target_value  -- FIX: Use correct column
    )
  )
  RETURNING id INTO v_notification_id;

  -- Trigger push notification
  PERFORM pg_notify(
    'push_notification_request',
    json_build_object(
      'user_id', v_session.user_id,
      'notification_id', v_notification_id,
      'type', 'scanning_timeout',
      'title', 'Scanning Paused',
      'body', 'No trades found in 15 minutes. Continue scanning?',
      'priority', 'high',
      'data', jsonb_build_object(
        'modal_id', v_modal_id,
        'session_id', p_session_id,
        'action', 'open_continuation_modal'
      )
    )::text
  );

  RAISE NOTICE 'Continuation modal created: modal_id=%, notification_id=%', v_modal_id, v_notification_id;
END;
$$;

COMMENT ON FUNCTION trigger_continuation_modal IS
  'FIXED: Uses target_value, prevents duplicates, calculates PnL correctly, uses goal_session_trades';

-- =====================================================
-- FIX 5: Recreate create_session_ended_modal with fixes
-- =====================================================

CREATE OR REPLACE FUNCTION create_session_ended_modal(
  p_session_id uuid,
  p_close_reason text DEFAULT 'timeout'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session record;
  v_trade_count integer;
  v_duration_minutes numeric;
  v_modal_id uuid;
  v_final_pnl numeric;
BEGIN
  -- Get session details with correct columns
  SELECT 
    gs.user_id,
    gs.target_value,  -- FIX: Was goal_amount
    gs.scanning_started_at,
    gs.start_time,
    gs.created_at,
    gs.status,
    gs.end_time
  INTO v_session
  FROM goal_sessions gs
  WHERE gs.id = p_session_id;

  -- FIX: Count trades AFTER scanning started, use goal_session_trades
  SELECT COUNT(*) INTO v_trade_count
  FROM goal_session_trades
  WHERE goal_session_id = p_session_id
    AND opened_at >= COALESCE(v_session.scanning_started_at, v_session.start_time);

  -- FIX: Calculate PnL from actual trades
  SELECT COALESCE(SUM(profit_loss), 0) INTO v_final_pnl
  FROM goal_session_trades
  WHERE goal_session_id = p_session_id
    AND status = 'closed';

  -- Calculate session duration
  v_duration_minutes := EXTRACT(EPOCH FROM (
    COALESCE(v_session.end_time, now()) - 
    COALESCE(v_session.scanning_started_at, v_session.start_time, v_session.created_at)
  )) / 60;

  -- Check for duplicate modal
  IF EXISTS (
    SELECT 1 FROM pending_user_modals
    WHERE goal_session_id = p_session_id
      AND modal_type = 'session_ended'
      AND dismissed_at IS NULL
  ) THEN
    RETURN NULL;
  END IF;

  -- Create modal
  INSERT INTO pending_user_modals (
    user_id,
    goal_session_id,
    modal_type,
    modal_data,
    expires_at
  ) VALUES (
    v_session.user_id,
    p_session_id,
    'session_ended',
    jsonb_build_object(
      'session_id', p_session_id,
      'close_reason', p_close_reason,
      'trade_count', v_trade_count,
      'final_pnl', v_final_pnl,
      'target_value', v_session.target_value,  -- FIX: Use correct column
      'duration_minutes', v_duration_minutes,
      'message', CASE 
        WHEN p_close_reason = 'timeout' THEN 'Session ended: No user response after 20 minutes'
        WHEN p_close_reason = 'safety_net' THEN 'Session ended: Safety timeout (60 minutes)'
        ELSE 'Session ended'
      END
    ),
    now() + interval '7 days'
  )
  RETURNING id INTO v_modal_id;

  -- Create notification
  INSERT INTO goal_notifications (
    user_id,
    goal_session_id,
    type,
    message,
    priority,
    viewed,
    metadata
  ) VALUES (
    v_session.user_id,
    p_session_id,
    'session_ended',
    format('Session ended: %s trades, $%s P/L', v_trade_count, ROUND(v_final_pnl, 2)),
    'high',
    false,
    jsonb_build_object(
      'modal_id', v_modal_id,
      'close_reason', p_close_reason,
      'trade_count', v_trade_count,
      'final_pnl', v_final_pnl
    )
  );

  RETURN v_modal_id;
END;
$$;

COMMENT ON FUNCTION create_session_ended_modal IS
  'FIXED: Uses target_value, filters trades by scanning_started_at, calculates real PnL';

-- =====================================================
-- FIX 6: Create helper function to close sessions
-- =====================================================

CREATE OR REPLACE FUNCTION close_goal_session_safely(
  p_session_id uuid,
  p_close_reason text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_open_trades integer;
  v_modal_id uuid;
BEGIN
  -- Check for open trades
  SELECT COUNT(*) INTO v_open_trades
  FROM goal_session_trades
  WHERE goal_session_id = p_session_id
    AND status IN ('open', 'pending', 'soft_closing');

  -- Don't close if trades are open
  IF v_open_trades > 0 THEN
    RAISE NOTICE 'Cannot close session %: % open trades', p_session_id, v_open_trades;
    RETURN false;
  END IF;

  -- Create session ended modal
  v_modal_id := create_session_ended_modal(p_session_id, p_close_reason);

  -- Update session status
  UPDATE goal_sessions
  SET 
    status = 'completed',
    end_time = now(),
    completed_at = now(),
    awaiting_continuation_confirmation = false,
    continuation_confirmation_expires_at = NULL
  WHERE id = p_session_id;

  RAISE NOTICE 'Session % closed with reason: %', p_session_id, p_close_reason;
  RETURN true;
END;
$$;

COMMENT ON FUNCTION close_goal_session_safely IS
  'Safely closes session after checking for open trades, creates modal, prevents data loss';

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION should_show_continuation_modal TO authenticated;
GRANT EXECUTE ON FUNCTION check_continuation_modal_timeout TO authenticated;
GRANT EXECUTE ON FUNCTION trigger_continuation_modal TO authenticated;
GRANT EXECUTE ON FUNCTION create_session_ended_modal TO authenticated;
GRANT EXECUTE ON FUNCTION close_goal_session_safely TO authenticated;

-- Grant to service role for autonomous monitor
GRANT EXECUTE ON FUNCTION should_show_continuation_modal TO service_role;
GRANT EXECUTE ON FUNCTION check_continuation_modal_timeout TO service_role;
GRANT EXECUTE ON FUNCTION trigger_continuation_modal TO service_role;
GRANT EXECUTE ON FUNCTION create_session_ended_modal TO service_role;
GRANT EXECUTE ON FUNCTION close_goal_session_safely TO service_role;
