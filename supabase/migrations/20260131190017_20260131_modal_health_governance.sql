/*
  # Modal Health Tracking & Stuck Modal Recovery (CCIP + Governance Compliant)
  
  1. New Tables
    - `modal_health_log` - Track modal lifecycle for stuck detection
      - Timestamps for open/close/action events
      - Identifies modals stuck > 10 minutes
      - Governance audit trail for all modal interactions
    
    - `modal_event_audit` - SSOT for modal state changes
      - Atomic logging of all modal state transitions
      - Owned by ModalQueueManager service (centralized)
      - Enables reconstruction of modal sequence
  
  2. Modified Tables
    - `pending_user_modals` - Add health check fields
      - last_health_check_at for periodic monitoring
      - times_shown counter for duplicate detection
      - is_stuck flag for failed recovery attempts
  
  3. Security
    - RLS policies allow authenticated users to view own modals
    - Service role monitors all modals for health
    - Changes tracked by CCIP governance system
  
  4. Important Notes
    - Modal state is SSOT: owned by ModalQueueManager only
    - UI components read modal state but cannot modify directly
    - All state transitions logged before database update
    - Automatic cleanup of stuck modals after 10 minutes
*/

CREATE TABLE IF NOT EXISTS modal_health_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  modal_id uuid REFERENCES pending_user_modals(id) ON DELETE SET NULL,
  modal_type TEXT NOT NULL,
  session_id uuid,
  
  opened_at TIMESTAMPTZ NOT NULL,
  first_action_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  
  action_taken TEXT,
  total_seconds_open INT,
  
  is_stuck BOOLEAN DEFAULT false,
  stuck_reason TEXT,
  
  auto_closed_by_system BOOLEAN DEFAULT false,
  close_method TEXT CHECK (close_method IN ('user_action', 'auto_dismiss', 'timeout', 'system_force_close', 'error_recovery')),
  
  event_count INT DEFAULT 0,
  last_event_at TIMESTAMPTZ,
  last_event_type TEXT,
  
  governance_log_id uuid,
  
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_modal_health_log_user_id 
  ON modal_health_log(user_id);
CREATE INDEX IF NOT EXISTS idx_modal_health_log_is_stuck 
  ON modal_health_log(is_stuck) WHERE is_stuck = true;
CREATE INDEX IF NOT EXISTS idx_modal_health_log_opened_at 
  ON modal_health_log(opened_at DESC);

CREATE TABLE IF NOT EXISTS modal_event_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  modal_id uuid REFERENCES pending_user_modals(id) ON DELETE SET NULL,
  modal_type TEXT NOT NULL,
  
  event_type TEXT NOT NULL CHECK (event_type IN ('opened', 'action_triggered', 'dismissed', 'auto_closed', 'error', 'force_closed')),
  event_details JSONB,
  
  service_responsible TEXT CHECK (service_responsible IN ('modal_queue_manager', 'global_dialog_manager', 'mid_trade_queue', 'system_recovery')),
  
  governance_log_id uuid,
  
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_modal_event_audit_user_id 
  ON modal_event_audit(user_id);
CREATE INDEX IF NOT EXISTS idx_modal_event_audit_modal_id 
  ON modal_event_audit(modal_id);
CREATE INDEX IF NOT EXISTS idx_modal_event_audit_event_type 
  ON modal_event_audit(event_type);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pending_user_modals' AND column_name = 'last_health_check_at'
  ) THEN
    ALTER TABLE pending_user_modals ADD COLUMN last_health_check_at TIMESTAMPTZ;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pending_user_modals' AND column_name = 'times_shown'
  ) THEN
    ALTER TABLE pending_user_modals ADD COLUMN times_shown INT DEFAULT 0;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pending_user_modals' AND column_name = 'is_stuck'
  ) THEN
    ALTER TABLE pending_user_modals ADD COLUMN is_stuck BOOLEAN DEFAULT false;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION log_modal_event(
  p_user_id uuid,
  p_modal_id uuid,
  p_modal_type TEXT,
  p_event_type TEXT,
  p_event_details jsonb,
  p_service_responsible TEXT
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
  -- Log to governance
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

  -- Log to audit trail
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

GRANT EXECUTE ON FUNCTION log_modal_event TO authenticated, service_role;

CREATE OR REPLACE FUNCTION detect_and_recover_stuck_modal(
  p_user_id uuid,
  p_modal_id uuid,
  p_stuck_threshold_minutes INT DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_modal record;
  v_health record;
  v_duration_minutes INT;
  v_result jsonb;
BEGIN
  v_result := jsonb_build_object('recovered', false, 'reason', '');

  -- Fetch modal
  SELECT * INTO v_modal
  FROM pending_user_modals
  WHERE id = p_modal_id AND user_id = p_user_id;

  IF v_modal IS NULL THEN
    v_result := jsonb_set(v_result, '{reason}', '"Modal not found"'::jsonb);
    RETURN v_result;
  END IF;

  -- Check if stuck
  SELECT * INTO v_health
  FROM modal_health_log
  WHERE modal_id = p_modal_id
  ORDER BY opened_at DESC
  LIMIT 1;

  IF v_health IS NULL THEN
    RETURN v_result;
  END IF;

  v_duration_minutes := EXTRACT(EPOCH FROM (now() - v_health.opened_at)) / 60;

  IF v_duration_minutes < p_stuck_threshold_minutes THEN
    v_result := jsonb_set(v_result, '{reason}', 
      jsonb_build_object('message', 'Not stuck yet', 'open_minutes', v_duration_minutes)::text::jsonb);
    RETURN v_result;
  END IF;

  -- Modal is stuck! Force close it
  UPDATE pending_user_modals
  SET is_dismissed = true, is_stuck = true, dismissed_at = now()
  WHERE id = p_modal_id;

  UPDATE modal_health_log
  SET 
    is_stuck = true,
    stuck_reason = 'Auto-detected stuck modal - open for ' || v_duration_minutes || ' minutes',
    closed_at = now(),
    auto_closed_by_system = true,
    close_method = 'system_force_close',
    total_seconds_open = v_duration_minutes * 60
  WHERE id = v_health.id;

  -- Log recovery event
  PERFORM log_modal_event(
    p_user_id,
    p_modal_id,
    v_modal.notification_type,
    'force_closed',
    jsonb_build_object(
      'reason', 'Auto-recovery: stuck for ' || v_duration_minutes || ' minutes',
      'threshold_minutes', p_stuck_threshold_minutes
    ),
    'system_recovery'
  );

  v_result := jsonb_set(v_result, '{recovered}', 'true'::jsonb);
  v_result := jsonb_set(v_result, '{reason}', 
    jsonb_build_object('message', 'Stuck modal force-closed', 'was_open_minutes', v_duration_minutes)::text::jsonb);

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION detect_and_recover_stuck_modal TO authenticated, service_role;

CREATE OR REPLACE FUNCTION cleanup_stuck_modals()
RETURNS TABLE(user_id uuid, recovered_count INT, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stuck_modals RECORD;
  v_recovered_count INT := 0;
BEGIN
  -- Find all stuck modals still pending
  FOR v_stuck_modals IN
    SELECT DISTINCT pum.user_id, pum.id as modal_id
    FROM pending_user_modals pum
    WHERE 
      pum.is_dismissed = false 
      AND pum.created_at < now() - interval '10 minutes'
  LOOP
    BEGIN
      PERFORM detect_and_recover_stuck_modal(v_stuck_modals.user_id, v_stuck_modals.modal_id);
      v_recovered_count := v_recovered_count + 1;
    EXCEPTION WHEN OTHERS THEN
      RETURN QUERY SELECT v_stuck_modals.user_id, 0, SQLERRM;
      RETURN;
    END;
  END LOOP;

  RETURN QUERY SELECT NULL::uuid, v_recovered_count, NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION cleanup_stuck_modals TO service_role;

ALTER TABLE modal_health_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own modal health"
  ON modal_health_log
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Service role full access"
  ON modal_health_log
  FOR ALL
  TO service_role
  USING (true);

ALTER TABLE modal_event_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own modal events"
  ON modal_event_audit
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Service role full access"
  ON modal_event_audit
  FOR ALL
  TO service_role
  USING (true);
