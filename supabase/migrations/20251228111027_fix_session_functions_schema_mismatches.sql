/*
  # Fix Session Management Functions - Schema Mismatch Repair
  
  ## Critical Issue Fixed
  Database functions were referencing columns that don't exist in goal_sessions table:
  - `gs.current_pnl` → Does NOT exist (should use `current_progress` or calculate from trades)
  - `gs.goal_amount` → Does NOT exist (correct column is `target_value`)
  - `gs.end_time` → Does NOT exist (correct column is `completed_at`)
  
  ## What This Migration Does
  1. Fixes `check_continuation_modal_timeout` to calculate PnL from trades instead of non-existent column
  2. Fixes `force_close_stale_session` to calculate PnL from trades instead of non-existent column
  3. Fixes `create_session_ended_modal` to calculate PnL from trades instead of non-existent column
  4. All functions now use correct column names throughout
  5. Adds dynamic PnL calculation from goal_session_trades table
  
  ## Impact
  - Sessions will no longer get stuck in "awaiting_continuation" status
  - Timeout functions will execute successfully without column errors
  - Push notifications will send with correct data
  - Session ended modals will display accurate information
  
  ## Security
  - All functions maintain SECURITY DEFINER
  - No changes to RLS policies
  - No breaking changes to existing data
*/

-- ============================================================================
-- Fix check_continuation_modal_timeout - Remove current_pnl references
-- ============================================================================

CREATE OR REPLACE FUNCTION check_continuation_modal_timeout(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session record;
  v_timed_out boolean := false;
  v_duration_minutes numeric;
  v_trades_count integer;
  v_close_reason text;
  v_calculated_pnl numeric;
BEGIN
  SELECT
    awaiting_continuation_confirmation,
    continuation_confirmation_expires_at,
    status,
    scanning_started_at,
    created_at,
    user_id,
    current_progress,
    target_value
  INTO v_session
  FROM goal_sessions
  WHERE id = p_session_id;

  IF v_session IS NULL THEN
    RETURN false;
  END IF;

  -- Calculate PnL from trades (FIXED: no more current_pnl column reference)
  SELECT COALESCE(SUM(profit_loss), 0)
  INTO v_calculated_pnl
  FROM goal_session_trades
  WHERE goal_session_id = p_session_id
    AND status = 'closed';

  -- Check #1: Standard timeout (awaiting_continuation with expired timestamp)
  IF v_session.awaiting_continuation_confirmation
     AND v_session.continuation_confirmation_expires_at IS NOT NULL
     AND now() > v_session.continuation_confirmation_expires_at
     AND v_session.status IN ('awaiting_continuation', 'scanning', 'trade_pending')
  THEN
    v_close_reason := 'timeout';
    v_duration_minutes := EXTRACT(EPOCH FROM (now() - COALESCE(v_session.scanning_started_at, v_session.created_at))) / 60;

    -- Count trades in session
    SELECT COUNT(*) INTO v_trades_count
    FROM goal_session_trades
    WHERE goal_session_id = p_session_id
      AND status IN ('open', 'closed');

    -- Insert session_ended notification for push
    INSERT INTO goal_notifications (
      goal_session_id,
      user_id,
      type,
      priority,
      title,
      message,
      metadata,
      channels
    ) VALUES (
      p_session_id,
      v_session.user_id,
      'session_ended',
      'high',
      '⏰ Session Timed Out',
      format('Your session ended after no response. %s trade%s completed. Final: $%s',
        v_trades_count,
        CASE WHEN v_trades_count != 1 THEN 's' ELSE '' END,
        ROUND(v_calculated_pnl::numeric, 2)),
      jsonb_build_object(
        'close_reason', v_close_reason,
        'duration_minutes', v_duration_minutes,
        'trades_in_session', v_trades_count,
        'current_progress', v_calculated_pnl,
        'target_value', COALESCE(v_session.target_value, 0)
      ),
      ARRAY['in_app']
    );

    RAISE NOTICE '[check_continuation_modal_timeout] Session % timed out - auto-closing', p_session_id;

    UPDATE goal_sessions
    SET
      status = 'user_stopped',
      awaiting_continuation_confirmation = false,
      continuation_confirmation_expires_at = NULL,
      completed_at = now(),
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
      v_close_reason := 'safety_net';
      v_duration_minutes := EXTRACT(EPOCH FROM (now() - COALESCE(v_session.scanning_started_at, v_session.created_at))) / 60;

      -- Count trades in session
      SELECT COUNT(*) INTO v_trades_count
      FROM goal_session_trades
      WHERE goal_session_id = p_session_id
        AND status IN ('open', 'closed');

      -- Insert session_ended notification for push
      INSERT INTO goal_notifications (
        goal_session_id,
        user_id,
        type,
        priority,
        title,
        message,
        metadata,
        channels
      ) VALUES (
        p_session_id,
        v_session.user_id,
        'session_ended',
        'high',
        '🛡️ Safety Stop Triggered',
        format('Your session was auto-closed after 20 minutes. %s trade%s completed. Final: $%s',
          v_trades_count,
          CASE WHEN v_trades_count != 1 THEN 's' ELSE '' END,
          ROUND(v_calculated_pnl::numeric, 2)),
        jsonb_build_object(
          'close_reason', v_close_reason,
          'duration_minutes', v_duration_minutes,
          'trades_in_session', v_trades_count,
          'current_progress', v_calculated_pnl,
          'target_value', COALESCE(v_session.target_value, 0)
        ),
        ARRAY['in_app']
      );

      RAISE NOTICE '[check_continuation_modal_timeout] Session % safety net triggered - scanning >20min', p_session_id;

      UPDATE goal_sessions
      SET
        status = 'user_stopped',
        awaiting_continuation_confirmation = false,
        continuation_confirmation_expires_at = NULL,
        completed_at = now(),
        updated_at = now()
      WHERE id = p_session_id;

      v_timed_out := true;
    END IF;
  END IF;

  RETURN v_timed_out;
END;
$$;

COMMENT ON FUNCTION check_continuation_modal_timeout IS
  'FIXED: Calculates PnL from trades table, uses correct column names (target_value, completed_at)';

-- ============================================================================
-- Fix force_close_stale_session - Remove current_pnl references
-- ============================================================================

CREATE OR REPLACE FUNCTION force_close_stale_session(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session record;
  v_duration_minutes numeric;
  v_trades_count integer;
  v_calculated_pnl numeric;
BEGIN
  -- Get session and verify ownership
  SELECT
    id,
    user_id,
    status,
    scanning_started_at,
    created_at,
    current_progress,
    target_value
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

  -- Calculate duration
  v_duration_minutes := EXTRACT(EPOCH FROM (now() - COALESCE(v_session.scanning_started_at, v_session.created_at))) / 60;

  -- Count trades in session
  SELECT COUNT(*) INTO v_trades_count
  FROM goal_session_trades
  WHERE goal_session_id = p_session_id
    AND status IN ('open', 'closed');

  -- Calculate PnL from trades (FIXED: no more current_pnl column reference)
  SELECT COALESCE(SUM(profit_loss), 0)
  INTO v_calculated_pnl
  FROM goal_session_trades
  WHERE goal_session_id = p_session_id
    AND status = 'closed';

  -- Insert session_ended notification for push
  INSERT INTO goal_notifications (
    goal_session_id,
    user_id,
    type,
    priority,
    title,
    message,
    metadata,
    channels
  ) VALUES (
    p_session_id,
    v_session.user_id,
    'session_ended',
    'medium',
    '✋ Session Force Closed',
    format('Your session was force closed. %s trade%s completed. Final: $%s',
      v_trades_count,
      CASE WHEN v_trades_count != 1 THEN 's' ELSE '' END,
      ROUND(v_calculated_pnl::numeric, 2)),
    jsonb_build_object(
      'close_reason', 'force_closed',
      'duration_minutes', v_duration_minutes,
      'trades_in_session', v_trades_count,
      'current_progress', v_calculated_pnl,
      'target_value', COALESCE(v_session.target_value, 0)
    ),
    ARRAY['in_app']
  );

  -- Force close the session
  UPDATE goal_sessions
  SET
    status = 'user_stopped',
    completed_at = now(),
    awaiting_continuation_confirmation = false,
    continuation_confirmation_expires_at = NULL,
    updated_at = now()
  WHERE id = p_session_id;

  -- Dismiss any pending modals
  UPDATE pending_user_modals
  SET
    dismissed_at = now(),
    user_action = 'force_closed'
  WHERE goal_session_id = p_session_id
    AND dismissed_at IS NULL;

  RAISE NOTICE '[force_close_stale_session] Session % force closed by user', p_session_id;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION force_close_stale_session IS
  'FIXED: Calculates PnL from trades table, uses correct column names, dismisses pending modals';

-- ============================================================================
-- Fix create_session_ended_modal - Remove current_pnl references
-- ============================================================================

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
  v_modal_id uuid;
  v_duration_minutes numeric;
  v_trade_count integer;
  v_calculated_pnl numeric;
BEGIN
  -- Get session details (FIXED: Use target_value instead of goal_amount)
  SELECT
    gs.user_id,
    gs.target_value,
    gs.scanning_started_at,
    gs.start_time,
    gs.created_at,
    gs.status,
    gs.completed_at
  INTO v_session
  FROM goal_sessions gs
  WHERE gs.id = p_session_id;

  -- Get trade count
  SELECT COUNT(*) INTO v_trade_count
  FROM goal_session_trades
  WHERE goal_session_id = p_session_id;

  -- Calculate PnL from trades (FIXED: no more current_pnl column reference)
  SELECT COALESCE(SUM(profit_loss), 0)
  INTO v_calculated_pnl
  FROM goal_session_trades
  WHERE goal_session_id = p_session_id
    AND status = 'closed';

  -- Calculate session duration in minutes
  v_duration_minutes := EXTRACT(EPOCH FROM (
    COALESCE(v_session.completed_at, now()) -
    COALESCE(v_session.scanning_started_at, v_session.start_time, v_session.created_at)
  )) / 60;

  -- Check if a session_ended modal already exists for this session
  IF EXISTS (
    SELECT 1 FROM pending_user_modals
    WHERE goal_session_id = p_session_id
      AND modal_type = 'session_ended'
      AND dismissed_at IS NULL
  ) THEN
    -- Already exists, don't create duplicate
    RETURN NULL;
  END IF;

  -- Create persistent session_ended modal
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
      'duration_minutes', ROUND(v_duration_minutes::numeric, 1),
      'trades_in_session', v_trade_count,
      'current_progress', v_calculated_pnl,
      'target_value', v_session.target_value,
      'final_status', v_session.status,
      'timestamp', now(),
      'message', CASE
        WHEN p_close_reason = 'timeout' THEN
          'Your session closed automatically because no response was received within the 60-second window.'
        WHEN p_close_reason = 'safety_net' THEN
          'Your session closed automatically after 20 minutes of scanning without finding a trade.'
        WHEN p_close_reason = 'user_stopped' THEN
          'Your session was closed as requested.'
        ELSE
          'Your session has ended.'
      END
    ),
    now() + interval '7 days'  -- Modal expires in 7 days
  )
  RETURNING id INTO v_modal_id;

  RAISE NOTICE '[create_session_ended_modal] Created modal % for session % (reason: %)',
    v_modal_id, p_session_id, p_close_reason;

  RETURN v_modal_id;
END;
$$;

COMMENT ON FUNCTION create_session_ended_modal IS
  'FIXED: Calculates PnL from trades table, uses correct column names (target_value, completed_at)';

-- ============================================================================
-- Grant permissions
-- ============================================================================

GRANT EXECUTE ON FUNCTION check_continuation_modal_timeout TO service_role;
GRANT EXECUTE ON FUNCTION force_close_stale_session TO authenticated;
GRANT EXECUTE ON FUNCTION create_session_ended_modal TO authenticated;
GRANT EXECUTE ON FUNCTION create_session_ended_modal TO service_role;
