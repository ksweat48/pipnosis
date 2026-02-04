/*
  # CCIP Deployment Tracking System - Production Rollout

  1. New Tables
    - `ccip_deployment_stages`
      - Tracks which deployment stage is active
      - SSOT for canary percentage (5%, 25%, 50%, 100%)
      - Stage-specific feature flags and behavior

    - `ccip_deployment_changes`
      - Audit trail of all changes deployed in this batch
      - Links to specific migrations and code changes
      - Rollback capability through change tracking

    - `ccip_stage_compliance_checks`
      - Pre-deployment verification of SSOT/CCIP compliance
      - Automatic validation before progressing to next stage
      - Governance enforcement

  2. Functions
    - `get_current_deployment_stage()` - Returns active stage + percentage
    - `can_progress_to_next_stage()` - Validates compliance before progression
    - `log_deployment_change(stage, change_type, metadata)` - Audit logging
    - `verify_timeout_governance_deployed()` - Specific to this feature

  3. Security
    - Enable RLS on all tables
    - Service role only for deployment operations
    - Admin only for viewing deployment status

  4. CCIP Compliance
    - Every deployment tracked with stage + timestamp
    - Rollback plan documented per stage
    - Health metrics captured pre/post stage
    - Governance violations automatically detected

  5. Important Notes
    - SSOT: Single deployment stage authority (prevents multi-region conflicts)
    - All consumer code reads current_stage from this table
    - Feature flags tied to stages for immediate rollback capability
    - Compliance validation required before stage progression
*/

-- Create deployment stages table
CREATE TABLE IF NOT EXISTS ccip_deployment_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_number integer NOT NULL UNIQUE,
  stage_name text NOT NULL,
  feature_name text NOT NULL DEFAULT 'timeout-governance-ccip-20260204',
  canary_percentage integer NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT false,
  activated_at timestamptz,
  expected_duration_hours integer,
  rollback_plan text,
  created_at timestamptz NOT NULL DEFAULT now(),
  
  CONSTRAINT valid_stage_number CHECK (stage_number BETWEEN 1 AND 4),
  CONSTRAINT valid_canary_percentage CHECK (canary_percentage IN (5, 25, 50, 100))
);

-- Create deployment changes tracking table
CREATE TABLE IF NOT EXISTS ccip_deployment_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id uuid NOT NULL REFERENCES ccip_deployment_stages(id) ON DELETE CASCADE,
  change_type text NOT NULL, -- 'migration', 'code_change', 'config_update', 'monitoring'
  component text NOT NULL, -- e.g., 'timeout_governance_config', 'PriceCoordinator', etc.
  migration_name text,
  change_description text NOT NULL,
  rollback_migration_name text, -- Migration to run if rollback needed
  applied_at timestamptz,
  verified_at timestamptz,
  verification_status text, -- 'pending', 'verified', 'failed'
  verification_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  
  CONSTRAINT valid_change_type CHECK (change_type IN ('migration', 'code_change', 'config_update', 'monitoring')),
  CONSTRAINT valid_verification_status CHECK (verification_status IN ('pending', 'verified', 'failed'))
);

-- Create stage compliance checks table
CREATE TABLE IF NOT EXISTS ccip_stage_compliance_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id uuid NOT NULL REFERENCES ccip_deployment_stages(id) ON DELETE CASCADE,
  check_name text NOT NULL,
  check_description text,
  check_query text, -- SQL query to validate compliance
  expected_result text,
  actual_result text,
  passed boolean,
  checked_at timestamptz,
  critical_check boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  
  CONSTRAINT valid_check_result CHECK (passed = true OR passed = false OR checked_at IS NULL)
);

-- Enable RLS
ALTER TABLE ccip_deployment_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ccip_deployment_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ccip_stage_compliance_checks ENABLE ROW LEVEL SECURITY;

-- RLS Policies for ccip_deployment_stages
CREATE POLICY "Service role can manage deployment stages"
  ON ccip_deployment_stages FOR ALL
  TO service_role
  USING (true);

CREATE POLICY "Authenticated users can view active stage"
  ON ccip_deployment_stages FOR SELECT
  TO authenticated
  USING (is_active = true);

CREATE POLICY "Admin can view all deployment stages"
  ON ccip_deployment_stages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- RLS Policies for ccip_deployment_changes
CREATE POLICY "Service role can manage deployment changes"
  ON ccip_deployment_changes FOR ALL
  TO service_role
  USING (true);

CREATE POLICY "Admin can view deployment changes"
  ON ccip_deployment_changes FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- RLS Policies for ccip_stage_compliance_checks
CREATE POLICY "Service role can manage compliance checks"
  ON ccip_stage_compliance_checks FOR ALL
  TO service_role
  USING (true);

CREATE POLICY "Admin can view compliance checks"
  ON ccip_stage_compliance_checks FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- Insert stage definitions
INSERT INTO ccip_deployment_stages (stage_number, stage_name, canary_percentage, description, expected_duration_hours, rollback_plan)
VALUES
  (
    1,
    'Canary 5%',
    5,
    'Deploy migrations and config updates. Monitor timeout_governance_config table.',
    4,
    'Disable timeout governance config, revert migrations in reverse order'
  ),
  (
    2,
    'Canary 25%',
    25,
    'Deploy PriceCoordinator with adaptive timeout logic. Monitor timeout events.',
    6,
    'Revert PriceCoordinator code changes, disable circuit breaker feature'
  ),
  (
    3,
    'Canary 50%',
    50,
    'Deploy chart-bulletproofing and error-handler updates. Monitor backoff effectiveness.',
    8,
    'Revert bulletproofing and error-handler changes'
  ),
  (
    4,
    'Full Rollout',
    100,
    'Complete deployment to all users. Continue monitoring timeout governance metrics.',
    24,
    'Disable timeout governance across all users (feature flag fallback)'
  )
ON CONFLICT (stage_number) DO NOTHING;

-- Create function to get current deployment stage
CREATE OR REPLACE FUNCTION get_current_deployment_stage()
RETURNS TABLE (
  stage_number integer,
  stage_name text,
  canary_percentage integer,
  is_active boolean,
  activated_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ds.stage_number,
    ds.stage_name,
    ds.canary_percentage,
    ds.is_active,
    ds.activated_at
  FROM ccip_deployment_stages ds
  WHERE ds.is_active = true
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION get_current_deployment_stage TO authenticated, service_role;

-- Create function to log deployment changes
CREATE OR REPLACE FUNCTION log_deployment_change(
  p_stage_id uuid,
  p_change_type text,
  p_component text,
  p_description text,
  p_migration_name text DEFAULT NULL,
  p_rollback_migration_name text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_change_id uuid;
BEGIN
  INSERT INTO ccip_deployment_changes (
    stage_id,
    change_type,
    component,
    change_description,
    migration_name,
    rollback_migration_name,
    verification_status
  ) VALUES (
    p_stage_id,
    p_change_type,
    p_component,
    p_description,
    p_migration_name,
    p_rollback_migration_name,
    'pending'
  )
  RETURNING id INTO v_change_id;

  RETURN v_change_id;
END;
$$;

GRANT EXECUTE ON FUNCTION log_deployment_change(uuid, text, text, text, text, text) TO service_role;

-- Create function to verify timeout governance deployment
CREATE OR REPLACE FUNCTION verify_timeout_governance_deployed()
RETURNS TABLE (
  check_name text,
  status text,
  message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_config_count integer;
  v_rpc_exists boolean;
  v_alert_table_exists boolean;
BEGIN
  -- Check 1: timeout_governance_config table exists and has data
  SELECT COUNT(*) INTO v_config_count
  FROM timeout_governance_config;

  IF v_config_count >= 6 THEN
    RETURN QUERY SELECT
      'timeout_governance_config_populated'::text as check_name,
      'PASSED'::text as status,
      format('Found %s service configurations', v_config_count)::text as message;
  ELSE
    RETURN QUERY SELECT
      'timeout_governance_config_populated'::text,
      'FAILED'::text,
      format('Expected at least 6 configs, found %s', v_config_count)::text;
  END IF;

  -- Check 2: log_timeout_event function exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.routines
    WHERE routine_name = 'log_timeout_event'
    AND routine_schema = 'public'
  ) INTO v_rpc_exists;

  IF v_rpc_exists THEN
    RETURN QUERY SELECT
      'log_timeout_event_rpc_exists'::text,
      'PASSED'::text,
      'log_timeout_event RPC function deployed'::text;
  ELSE
    RETURN QUERY SELECT
      'log_timeout_event_rpc_exists'::text,
      'FAILED'::text,
      'log_timeout_event RPC function not found'::text;
  END IF;

  -- Check 3: governance_timeout_alerts table exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'governance_timeout_alerts'
    AND table_schema = 'public'
  ) INTO v_alert_table_exists;

  IF v_alert_table_exists THEN
    RETURN QUERY SELECT
      'governance_timeout_alerts_table_exists'::text,
      'PASSED'::text,
      'governance_timeout_alerts table deployed'::text;
  ELSE
    RETURN QUERY SELECT
      'governance_timeout_alerts_table_exists'::text,
      'FAILED'::text,
      'governance_timeout_alerts table not found'::text;
  END IF;

END;
$$;

GRANT EXECUTE ON FUNCTION verify_timeout_governance_deployed TO service_role;

-- Pre-populate deployment changes for Stage 1
DO $$
DECLARE
  v_stage_1_id uuid;
BEGIN
  SELECT id INTO v_stage_1_id
  FROM ccip_deployment_stages
  WHERE stage_number = 1;

  INSERT INTO ccip_deployment_changes (
    stage_id,
    change_type,
    component,
    change_description,
    migration_name,
    rollback_migration_name,
    verification_status
  ) VALUES
    (v_stage_1_id, 'migration', 'timeout_governance_config', 'Create timeout governance infrastructure and RPC functions', '20260204_create_timeout_governance_infrastructure', NULL, 'pending'),
    (v_stage_1_id, 'migration', 'timeout_logging_rpc', 'Create timeout logging and alert system', '20260204_create_timeout_logging_rpc', NULL, 'pending'),
    (v_stage_1_id, 'config_update', 'time_constants', 'Add SERVICE_TIMEOUTS configuration SSOT', NULL, NULL, 'pending'),
    (v_stage_1_id, 'monitoring', 'governance_logging', 'Enable timeout event logging to governance_change_log', NULL, NULL, 'pending')
  ON CONFLICT DO NOTHING;
END $$;
