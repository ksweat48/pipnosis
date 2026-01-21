/*
  # CCIP Change Tracking System
  
  ## Purpose
  Create comprehensive Change Control Intelligence Protocol (CCIP) tracking
  to ensure all changes follow proper protocols and maintain audit trail.
  
  ## Tables Created
  1. `ccip_change_requests` - Master change request tracking
  2. `ccip_stage_completions` - Track completion of each CCIP stage
  3. `ccip_system_map` - System map of affected files/services
  4. `ccip_logic_contracts` - Formal behavior specifications
  5. `ccip_test_results` - Test and simulation results
  6. `ccip_deployment_log` - Deployment tracking
  7. `ccip_verification_log` - Post-deploy verification
  8. `ccip_approvals` - Approval workflow
  
  ## Security
  - Enable RLS on all tables
  - Admin-only write access
  - Service role for automated logging
*/

-- Main change request table
CREATE TABLE IF NOT EXISTS ccip_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  change_title text NOT NULL,
  change_type text NOT NULL CHECK (change_type IN ('feature', 'bugfix', 'hotfix', 'refactor', 'migration', 'config', 'emergency')),
  priority text NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  
  requested_by uuid REFERENCES auth.users(id),
  
  description text NOT NULL,
  business_justification text,
  technical_impact text,
  risk_assessment text,
  
  ccip_status text DEFAULT 'initiated' CHECK (ccip_status IN (
    'initiated', 'system_map_complete', 'logic_contract_complete', 'simulation_complete',
    'compatibility_verified', 'staged_deployment_complete', 'verification_complete',
    'approved', 'deployed', 'verified', 'failed', 'rolled_back', 'emergency_bypass'
  )),
  
  ccip_bypass_reason text,
  ccip_score numeric(5,2) DEFAULT 0.00,
  
  governance_status text DEFAULT 'pending' CHECK (governance_status IN ('pending', 'approved', 'rejected', 'emergency_override', 'retrospective_review')),
  
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  
  deployed_at timestamptz,
  deployment_method text,
  rollback_plan text,
  
  related_migration text,
  modified_files text[],
  database_changes boolean DEFAULT false,
  breaking_changes boolean DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_ccip_change_status ON ccip_change_requests(ccip_status);
CREATE INDEX IF NOT EXISTS idx_ccip_change_governance ON ccip_change_requests(governance_status);

-- Stage completions
CREATE TABLE IF NOT EXISTS ccip_stage_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  
  change_id uuid NOT NULL REFERENCES ccip_change_requests(id) ON DELETE CASCADE,
  
  stage_name text NOT NULL CHECK (stage_name IN (
    'system_map', 'logic_contract', 'dry_run_simulation',
    'compatibility_check', 'staged_deployment', 'post_deploy_verification'
  )),
  
  completed boolean DEFAULT false,
  completed_at timestamptz,
  completed_by uuid REFERENCES auth.users(id),
  
  duration_minutes integer,
  notes text,
  quality_score numeric(5,2),
  issues_found integer DEFAULT 0,
  
  UNIQUE(change_id, stage_name)
);

-- System map
CREATE TABLE IF NOT EXISTS ccip_system_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  
  change_id uuid NOT NULL REFERENCES ccip_change_requests(id) ON DELETE CASCADE,
  
  component_type text NOT NULL CHECK (component_type IN ('frontend', 'backend', 'database', 'api', 'service', 'config')),
  component_name text NOT NULL,
  file_path text,
  
  change_impact text NOT NULL CHECK (change_impact IN ('create', 'modify', 'delete', 'refactor')),
  
  risk_level text CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  risk_description text,
  
  notes text
);

-- Logic contracts
CREATE TABLE IF NOT EXISTS ccip_logic_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  
  change_id uuid NOT NULL REFERENCES ccip_change_requests(id) ON DELETE CASCADE,
  
  contract_name text NOT NULL,
  old_behavior text NOT NULL,
  new_behavior text NOT NULL,
  
  edge_cases jsonb,
  acceptance_criteria text[],
  
  validated boolean DEFAULT false,
  
  UNIQUE(change_id, contract_name)
);

-- Test results
CREATE TABLE IF NOT EXISTS ccip_test_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  
  change_id uuid NOT NULL REFERENCES ccip_change_requests(id) ON DELETE CASCADE,
  
  test_type text CHECK (test_type IN ('unit_test', 'integration_test', 'migration_dry_run', 'load_test', 'security_scan')),
  test_environment text,
  
  passed boolean NOT NULL,
  test_count integer,
  passed_count integer,
  failed_count integer,
  
  test_output text,
  error_messages text[],
  
  records_affected integer,
  
  notes text
);

-- Deployment log
CREATE TABLE IF NOT EXISTS ccip_deployment_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  
  change_id uuid NOT NULL REFERENCES ccip_change_requests(id) ON DELETE CASCADE,
  
  stage_order integer NOT NULL,
  stage_name text NOT NULL,
  
  deployed boolean DEFAULT false,
  deployed_at timestamptz,
  deployed_by uuid REFERENCES auth.users(id),
  
  health_check_passed boolean,
  rollback_available boolean DEFAULT true,
  
  notes text,
  
  UNIQUE(change_id, stage_order)
);

-- Verification log
CREATE TABLE IF NOT EXISTS ccip_verification_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  
  change_id uuid NOT NULL REFERENCES ccip_change_requests(id) ON DELETE CASCADE,
  
  check_type text NOT NULL CHECK (check_type IN ('functionality', 'performance', 'security', 'data_integrity')),
  check_name text NOT NULL,
  
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'passed', 'failed', 'skipped')),
  
  verified_by uuid REFERENCES auth.users(id),
  result_details text,
  
  issues_found text[],
  corrective_actions text[]
);

-- Approvals
CREATE TABLE IF NOT EXISTS ccip_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  
  change_id uuid NOT NULL REFERENCES ccip_change_requests(id) ON DELETE CASCADE,
  
  approver_id uuid REFERENCES auth.users(id),
  approver_role text NOT NULL,
  
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected', 'conditional_approval')),
  decision_at timestamptz DEFAULT now(),
  
  comments text,
  bypass_ccip boolean DEFAULT false
);

-- Enable RLS
ALTER TABLE ccip_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE ccip_stage_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ccip_system_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE ccip_logic_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ccip_test_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE ccip_deployment_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE ccip_verification_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE ccip_approvals ENABLE ROW LEVEL SECURITY;

-- Service role policies
CREATE POLICY "Service role ccip_changes" ON ccip_change_requests FOR ALL TO service_role USING (true);
CREATE POLICY "Service role ccip_stages" ON ccip_stage_completions FOR ALL TO service_role USING (true);
CREATE POLICY "Service role ccip_map" ON ccip_system_map FOR ALL TO service_role USING (true);
CREATE POLICY "Service role ccip_contracts" ON ccip_logic_contracts FOR ALL TO service_role USING (true);
CREATE POLICY "Service role ccip_tests" ON ccip_test_results FOR ALL TO service_role USING (true);
CREATE POLICY "Service role ccip_deploy" ON ccip_deployment_log FOR ALL TO service_role USING (true);
CREATE POLICY "Service role ccip_verify" ON ccip_verification_log FOR ALL TO service_role USING (true);
CREATE POLICY "Service role ccip_approve" ON ccip_approvals FOR ALL TO service_role USING (true);

-- Admin policies (using correct column name: id, not user_id)
CREATE POLICY "Admins ccip_changes" ON ccip_change_requests FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.is_admin = true));

CREATE POLICY "Admins ccip_stages" ON ccip_stage_completions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.is_admin = true));

CREATE POLICY "Admins ccip_map" ON ccip_system_map FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.is_admin = true));

CREATE POLICY "Admins ccip_contracts" ON ccip_logic_contracts FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.is_admin = true));

CREATE POLICY "Admins ccip_tests" ON ccip_test_results FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.is_admin = true));

CREATE POLICY "Admins ccip_deploy" ON ccip_deployment_log FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.is_admin = true));

CREATE POLICY "Admins ccip_verify" ON ccip_verification_log FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.is_admin = true));

CREATE POLICY "Admins ccip_approve" ON ccip_approvals FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.is_admin = true));

-- Read-only transparency
CREATE POLICY "Users view ccip_changes" ON ccip_change_requests FOR SELECT TO authenticated USING (true);

-- Helper function to calculate compliance score
CREATE OR REPLACE FUNCTION calculate_ccip_score(p_change_id uuid)
RETURNS numeric AS $$
DECLARE
  v_score numeric := 0;
  v_total integer := 6;
  v_completed integer := 0;
BEGIN
  SELECT COUNT(*) FILTER (WHERE completed = true)
  INTO v_completed
  FROM ccip_stage_completions
  WHERE change_id = p_change_id;
  
  v_score := (v_completed::numeric / v_total::numeric) * 100;
  
  UPDATE ccip_change_requests
  SET ccip_score = v_score
  WHERE id = p_change_id;
  
  RETURN v_score;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get CCIP summary
CREATE OR REPLACE FUNCTION get_ccip_summary()
RETURNS TABLE (
  total_changes bigint,
  approved bigint,
  pending bigint,
  emergency_bypasses bigint,
  avg_score numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*) as total_changes,
    COUNT(*) FILTER (WHERE governance_status = 'approved') as approved,
    COUNT(*) FILTER (WHERE governance_status = 'pending') as pending,
    COUNT(*) FILTER (WHERE ccip_status = 'emergency_bypass') as emergency_bypasses,
    AVG(ccip_score) as avg_score
  FROM ccip_change_requests
  WHERE created_at > now() - interval '30 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
