/*
  # Fix Modal Type Constraint and Schema Cache Refresh

  ## Problem 1: pending_user_modals_modal_type_check violation
  The GoalAchievementCoordinator inserts modal_type = 'goal_achieved_countdown' but this
  value is missing from the CHECK constraint on pending_user_modals. The constraint only
  allows: trade_closed, goal_achieved, session_update, continuation, session_ended,
  entry_edge_loss. Adding 'goal_achieved_countdown' resolves the 400 Bad Request and
  constraint violation errors.

  ## Problem 2: log_modal_event RPC returning 404
  The function exists in pg_proc with correct parameters and permissions but PostgREST
  schema cache is stale. Recreating the function forces PostgREST to reload and expose it.

  ## Changes
  1. Drop and recreate pending_user_modals_modal_type_check with goal_achieved_countdown added
  2. Recreate log_modal_event function body unchanged to flush PostgREST schema cache

  ## Security
  - No RLS changes - existing policies unchanged
  - log_modal_event remains SECURITY DEFINER with authenticated/service_role grants
*/

-- Fix 1: Add 'goal_achieved_countdown' to the modal_type CHECK constraint
ALTER TABLE pending_user_modals
  DROP CONSTRAINT IF EXISTS pending_user_modals_modal_type_check;

ALTER TABLE pending_user_modals
  ADD CONSTRAINT pending_user_modals_modal_type_check
  CHECK (modal_type IN (
    'trade_closed',
    'goal_achieved',
    'goal_achieved_countdown',
    'session_update',
    'continuation',
    'session_ended',
    'entry_edge_loss'
  ));

-- Fix 2: Recreate log_modal_event to force PostgREST schema cache refresh
CREATE OR REPLACE FUNCTION public.log_modal_event(
  p_user_id uuid,
  p_modal_id uuid,
  p_modal_type text,
  p_event_type text,
  p_event_details jsonb,
  p_service_responsible text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_governance_log_id uuid;
  v_audit_id uuid;
BEGIN
  INSERT INTO ccip_change_tracking (
    user_id,
    operation_type,
    table_name,
    record_id,
    change_details,
    governance_log_id
  ) VALUES (
    p_user_id,
    'MODAL_EVENT_' || p_event_type,
    'pending_user_modals',
    p_modal_id,
    jsonb_build_object(
      'modal_type', p_modal_type,
      'service', p_service_responsible,
      'details', p_event_details
    ),
    gen_random_uuid()
  )
  RETURNING governance_log_id INTO v_governance_log_id;

  INSERT INTO modal_event_audit (
    user_id,
    modal_id,
    modal_type,
    event_type,
    event_details,
    service_responsible,
    governance_log_id
  ) VALUES (
    p_user_id,
    p_modal_id,
    p_modal_type,
    p_event_type,
    p_event_details,
    p_service_responsible,
    v_governance_log_id
  )
  RETURNING id INTO v_audit_id;

  RETURN v_audit_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_modal_event(uuid, uuid, text, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_modal_event(uuid, uuid, text, text, jsonb, text) TO service_role;
