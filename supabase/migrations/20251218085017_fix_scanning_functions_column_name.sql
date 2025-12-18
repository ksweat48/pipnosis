/*
  # Fix Scanning Functions - Correct Column Name

  ## Problem
  The `trigger_scanning_cooldown` and `trigger_scanning_lockdown` functions are trying
  to INSERT into a column called `metadata`, but the actual column name in the
  `goal_notifications` table is `data`. This causes 400 errors when `can_scan_now` RPC is called.

  ## Solution
  Update both functions to use the correct column name: `data` instead of `metadata`

  ## Changes
  1. Recreate `trigger_scanning_cooldown` with correct column name
  2. Recreate `trigger_scanning_lockdown` with correct column name
*/

-- ============================================================================
-- Fix trigger_scanning_cooldown function
-- ============================================================================

CREATE OR REPLACE FUNCTION trigger_scanning_cooldown(
  p_session_id uuid
) RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  UPDATE goal_sessions
  SET
    scanning_cycle_status = 'cooldown',
    cooldown_started_at = v_now,
    cooldown_ends_at = v_now + interval '15 minutes',
    updated_at = v_now
  WHERE id = p_session_id;

  -- Create notification in goal_notifications table with correct column name 'data'
  INSERT INTO goal_notifications (
    goal_session_id,
    user_id,
    notification_type,
    priority,
    title,
    message,
    data
  )
  SELECT
    p_session_id,
    user_id,
    'alert',
    'medium',
    'Scanning Break',
    'Session complete. No quality trades found. Taking a 15-minute break before resuming.',
    jsonb_build_object(
      'session_id', p_session_id,
      'cooldown_ends_at', v_now + interval '15 minutes',
      'reason', 'session_complete'
    )
  FROM goal_sessions
  WHERE id = p_session_id;
END;
$$;

COMMENT ON FUNCTION trigger_scanning_cooldown(uuid) IS
  'Triggers 15-minute cooldown after session completion';

-- ============================================================================
-- Fix trigger_scanning_lockdown function
-- ============================================================================

CREATE OR REPLACE FUNCTION trigger_scanning_lockdown(
  p_session_id uuid
) RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  UPDATE goal_sessions
  SET
    scanning_cycle_status = 'lockdown',
    lockdown_started_at = v_now,
    lockdown_ends_at = v_now + interval '12 hours',
    cooldown_started_at = NULL,
    cooldown_ends_at = NULL,
    updated_at = v_now
  WHERE id = p_session_id;

  -- Create urgent notification in goal_notifications table with correct column name 'data'
  INSERT INTO goal_notifications (
    goal_session_id,
    user_id,
    notification_type,
    priority,
    title,
    message,
    data
  )
  SELECT
    p_session_id,
    user_id,
    'alert',
    'high',
    'Scanning Paused',
    'No quality trades found after 2.5 hours. Markets may be unfavorable. Scanning paused for 12 hours to preserve resources.',
    jsonb_build_object(
      'session_id', p_session_id,
      'lockdown_ends_at', v_now + interval '12 hours',
      'reason', 'no_trades_found'
    )
  FROM goal_sessions
  WHERE id = p_session_id;
END;
$$;

COMMENT ON FUNCTION trigger_scanning_lockdown(uuid) IS
  'Triggers 12-hour lockdown when no trades found after 2.5 hours';
