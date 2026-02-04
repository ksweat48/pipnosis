/*
  # CCIP Immutable Goals & Governance Audit System
  Fixes: Silent goal mutation bug, risk tolerance enforcement, governance compliance
*/

BEGIN;

-- Add immutable tracking to goal_sessions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'original_target_value'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN original_target_value numeric NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'user_accepted_adjustment'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN user_accepted_adjustment boolean NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'adjustment_accepted_at'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN adjustment_accepted_at timestamptz DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'adjustment_declined_at'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN adjustment_declined_at timestamptz DEFAULT NULL;
  END IF;
END $$;

-- Create Goal Target Advisories table
CREATE TABLE IF NOT EXISTS goal_target_advisories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_session_id uuid NOT NULL REFERENCES goal_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  original_requested numeric NOT NULL,
  advisory_recommended numeric NOT NULL,
  reason text NOT NULL,
  authority text NOT NULL,
  confidence_level numeric DEFAULT 0.5,
  status text NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review', 'accepted', 'rejected', 'expired')),
  user_action_at timestamptz DEFAULT NULL,
  user_action text DEFAULT NULL,
  expiration_at timestamptz DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_goal_target_advisories_session ON goal_target_advisories(goal_session_id);
CREATE INDEX IF NOT EXISTS idx_goal_target_advisories_user ON goal_target_advisories(user_id);
CREATE INDEX IF NOT EXISTS idx_goal_target_advisories_status ON goal_target_advisories(status);

ALTER TABLE goal_target_advisories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own advisories" ON goal_target_advisories;
CREATE POLICY "Users can view own advisories"
  ON goal_target_advisories FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own advisory status" ON goal_target_advisories;
CREATE POLICY "Users can update own advisory status"
  ON goal_target_advisories FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage advisories" ON goal_target_advisories;
CREATE POLICY "Service role can manage advisories"
  ON goal_target_advisories TO service_role USING (true) WITH CHECK (true);

-- Create Goal Modification Audit table
CREATE TABLE IF NOT EXISTS goal_modification_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_session_id uuid NOT NULL REFERENCES goal_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  modification_type text NOT NULL
    CHECK (modification_type IN ('initial_creation', 'user_accepted_advisory', 'user_rejected_advisory', 'position_size_change', 'risk_tolerance_change', 'system_adjustment')),
  original_value numeric NOT NULL,
  new_value numeric DEFAULT NULL,
  authority text NOT NULL,
  reason text NOT NULL,
  user_action_at timestamptz DEFAULT NULL,
  reversible boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_service text DEFAULT NULL,
  metadata jsonb DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_goal_modification_audit_session ON goal_modification_audit(goal_session_id);
CREATE INDEX IF NOT EXISTS idx_goal_modification_audit_user ON goal_modification_audit(user_id);
CREATE INDEX IF NOT EXISTS idx_goal_modification_audit_type ON goal_modification_audit(modification_type);
CREATE INDEX IF NOT EXISTS idx_goal_modification_audit_created ON goal_modification_audit(created_at DESC);

ALTER TABLE goal_modification_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own modification audit" ON goal_modification_audit;
CREATE POLICY "Users can view own modification audit"
  ON goal_modification_audit FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage audit" ON goal_modification_audit;
CREATE POLICY "Service role can manage audit"
  ON goal_modification_audit TO service_role USING (true) WITH CHECK (true);

-- Backfill historical data
UPDATE goal_sessions SET original_target_value = target_value WHERE original_target_value = 0;

INSERT INTO goal_modification_audit (
  goal_session_id, user_id, modification_type, original_value, new_value,
  authority, reason, created_at, created_by_service, metadata
)
SELECT gs.id, gs.user_id, 'initial_creation', gs.target_value, gs.target_value,
  'user_input', 'Initial goal session creation', gs.created_at,
  'migration-backfill-v1', jsonb_build_object('backfilled', true)
FROM goal_sessions gs
WHERE NOT EXISTS (SELECT 1 FROM goal_modification_audit gma WHERE gma.goal_session_id = gs.id);

-- Create immutability trigger
CREATE OR REPLACE FUNCTION prevent_immutable_goal_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.original_target_value != NEW.original_target_value THEN
    RAISE EXCEPTION 'CCIP VIOLATION: original_target_value is immutable';
  END IF;
  
  IF OLD.target_value != NEW.target_value 
    AND OLD.user_accepted_adjustment = NEW.user_accepted_adjustment
    AND NEW.user_accepted_adjustment = false THEN
    RAISE EXCEPTION 'CCIP VIOLATION: target_value change requires user advisory acceptance';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS prevent_immutable_goal_changes ON goal_sessions;
CREATE TRIGGER prevent_immutable_goal_changes
  BEFORE UPDATE ON goal_sessions FOR EACH ROW
  EXECUTE FUNCTION prevent_immutable_goal_change();

-- Create audit trigger
CREATE OR REPLACE FUNCTION audit_goal_modification()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.target_value != NEW.target_value THEN
    INSERT INTO goal_modification_audit (
      goal_session_id, user_id, modification_type, original_value, new_value,
      authority, reason, user_action_at, created_at, created_by_service, metadata
    ) VALUES (
      NEW.id, NEW.user_id, 'user_accepted_advisory', OLD.target_value, NEW.target_value,
      'advisory-acceptance', 'User accepted goal adjustment advisory', NEW.adjustment_accepted_at,
      now(), 'trigger-audit-goal-modification', jsonb_build_object('confidence', NEW.market_assessment_confidence)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS audit_goal_session_modification ON goal_sessions;
CREATE TRIGGER audit_goal_session_modification
  AFTER UPDATE ON goal_sessions FOR EACH ROW
  WHEN (OLD.target_value != NEW.target_value OR OLD.user_accepted_adjustment != NEW.user_accepted_adjustment)
  EXECUTE FUNCTION audit_goal_modification();

-- CCIP Compliance verification RPC
CREATE OR REPLACE FUNCTION verify_goal_ssot_compliance(p_goal_session_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_session goal_sessions%ROWTYPE;
  v_audit_count integer;
  v_advisory_count integer;
  v_violations text[] := ARRAY[]::text[];
BEGIN
  SELECT * INTO v_session FROM goal_sessions WHERE id = p_goal_session_id;
  
  IF v_session IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Goal session not found');
  END IF;
  
  IF v_session.original_target_value = 0 THEN
    v_violations := array_append(v_violations, 'original_target_value not set');
  END IF;
  
  IF v_session.target_value < v_session.original_target_value
    AND NOT v_session.user_accepted_adjustment THEN
    v_violations := array_append(v_violations, 'target_value reduced without user acceptance');
  END IF;
  
  IF v_session.user_accepted_adjustment AND v_session.adjustment_accepted_at IS NULL THEN
    v_violations := array_append(v_violations, 'user_accepted_adjustment=true but no timestamp');
  END IF;
  
  SELECT COUNT(*) INTO v_audit_count FROM goal_modification_audit WHERE goal_session_id = p_goal_session_id;
  IF v_audit_count = 0 THEN
    v_violations := array_append(v_violations, 'No audit records found');
  END IF;
  
  SELECT COUNT(*) INTO v_advisory_count FROM goal_target_advisories WHERE goal_session_id = p_goal_session_id;
  
  RETURN jsonb_build_object(
    'valid', (v_violations = ARRAY[]::text[]),
    'goal_session_id', p_goal_session_id,
    'original_target_value', v_session.original_target_value,
    'current_target_value', v_session.target_value,
    'audit_records_count', v_audit_count,
    'advisory_records_count', v_advisory_count,
    'violations', v_violations,
    'compliance_status', CASE WHEN v_violations = ARRAY[]::text[] THEN 'COMPLIANT' ELSE 'VIOLATION' END
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION verify_goal_ssot_compliance(uuid) TO authenticated, service_role;

-- User advisory acceptance RPC
CREATE OR REPLACE FUNCTION accept_goal_advisory(
  p_goal_session_id uuid,
  p_advisory_id uuid,
  p_accept boolean
)
RETURNS jsonb AS $$
DECLARE
  v_advisory goal_target_advisories%ROWTYPE;
  v_session goal_sessions%ROWTYPE;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  
  SELECT * INTO v_advisory FROM goal_target_advisories
  WHERE id = p_advisory_id AND goal_session_id = p_goal_session_id;
  
  IF v_advisory IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Advisory not found');
  END IF;
  
  IF v_advisory.user_id != auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;
  
  SELECT * INTO v_session FROM goal_sessions WHERE id = p_goal_session_id;
  
  UPDATE goal_target_advisories
  SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'rejected' END,
      user_action = CASE WHEN p_accept THEN 'accepted' ELSE 'rejected' END,
      user_action_at = now()
  WHERE id = p_advisory_id;
  
  IF p_accept THEN
    UPDATE goal_sessions
    SET target_value = v_advisory.advisory_recommended,
        user_accepted_adjustment = true,
        adjustment_accepted_at = now()
    WHERE id = p_goal_session_id;
  ELSE
    UPDATE goal_sessions SET adjustment_declined_at = now()
    WHERE id = p_goal_session_id;
    
    INSERT INTO goal_modification_audit (
      goal_session_id, user_id, modification_type, original_value, new_value,
      authority, reason, user_action_at, created_by_service
    ) VALUES (p_goal_session_id, auth.uid(), 'user_rejected_advisory',
      v_session.target_value, NULL, 'user-rejection',
      'User rejected goal adjustment advisory', now(), 'accept-goal-advisory-rpc');
  END IF;
  
  SELECT verify_goal_ssot_compliance(p_goal_session_id) INTO v_result;
  
  RETURN jsonb_build_object(
    'success', true,
    'action', CASE WHEN p_accept THEN 'accepted' ELSE 'rejected' END,
    'new_target_value', CASE WHEN p_accept THEN v_advisory.advisory_recommended ELSE v_session.target_value END,
    'compliance_check', v_result
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION accept_goal_advisory(uuid, uuid, boolean) TO authenticated;

COMMIT;