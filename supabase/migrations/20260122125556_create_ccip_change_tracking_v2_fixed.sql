/*
  # CCIP Change Tracking System v2

  1. New Tables
    - `ccip_changes`
      - Tracks all changes requiring CCIP compliance
      - Records compliance status and review outcomes
      - Links to monitoring data
    
    - `ccip_monitoring_snapshots`
      - Stores periodic monitoring snapshots
      - Tracks metrics over time
      - Enables trend analysis

  2. Security
    - Enable RLS on both tables
    - Admin-only write access
    - Service role can insert monitoring data
    - All authenticated users can read

  3. Functions
    - `record_ccip_monitoring_snapshot()` - Automated snapshot capture
*/

-- Create CCIP changes tracking table
CREATE TABLE IF NOT EXISTS ccip_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  change_id text UNIQUE NOT NULL,
  title text NOT NULL,
  description text,
  affected_components jsonb NOT NULL DEFAULT '[]',
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  
  -- CCIP Phase Completion
  system_map_completed boolean DEFAULT false,
  logic_contract_completed boolean DEFAULT false,
  dry_run_completed boolean DEFAULT false,
  compatibility_check_completed boolean DEFAULT false,
  staged_deployment_completed boolean DEFAULT false,
  post_deploy_monitoring_completed boolean DEFAULT false,
  
  -- Status and Compliance
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_review', 'approved', 'deployed', 'monitoring', 'completed', 'rolled_back')),
  ccip_compliant boolean DEFAULT false,
  retroactive_documentation boolean DEFAULT false,
  
  -- Timestamps
  deployed_at timestamptz,
  monitoring_started_at timestamptz,
  monitoring_completed_at timestamptz,
  
  -- Documentation
  documentation_url text,
  rollback_criteria jsonb,
  
  -- Metadata
  created_by uuid REFERENCES auth.users(id),
  reviewed_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create monitoring snapshots table
CREATE TABLE IF NOT EXISTS ccip_monitoring_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  change_id text NOT NULL REFERENCES ccip_changes(change_id) ON DELETE CASCADE,
  snapshot_time timestamptz NOT NULL DEFAULT now(),
  time_since_deploy interval,
  
  -- Metrics
  metrics jsonb NOT NULL DEFAULT '{}',
  
  -- Alert Status
  alert_level text CHECK (alert_level IN ('green', 'yellow', 'red')),
  alerts jsonb DEFAULT '[]',
  
  -- Notes
  notes text,
  
  created_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_ccip_changes_status ON ccip_changes(status);
CREATE INDEX IF NOT EXISTS idx_ccip_changes_deployed_at ON ccip_changes(deployed_at);
CREATE INDEX IF NOT EXISTS idx_ccip_monitoring_change_id ON ccip_monitoring_snapshots(change_id);
CREATE INDEX IF NOT EXISTS idx_ccip_monitoring_time ON ccip_monitoring_snapshots(snapshot_time);

-- Enable RLS
ALTER TABLE ccip_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ccip_monitoring_snapshots ENABLE ROW LEVEL SECURITY;

-- RLS Policies for ccip_changes
CREATE POLICY "All authenticated users can read CCIP changes"
  ON ccip_changes FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert CCIP changes"
  ON ccip_changes FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can update CCIP changes"
  ON ccip_changes FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

CREATE POLICY "Service role can manage CCIP changes"
  ON ccip_changes FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- RLS Policies for ccip_monitoring_snapshots
CREATE POLICY "All authenticated users can read monitoring snapshots"
  ON ccip_monitoring_snapshots FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can insert monitoring snapshots"
  ON ccip_monitoring_snapshots FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Admins can manage monitoring snapshots"
  ON ccip_monitoring_snapshots FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- Function to record monitoring snapshot
CREATE OR REPLACE FUNCTION record_ccip_monitoring_snapshot(
  p_change_id text,
  p_metrics jsonb,
  p_alert_level text DEFAULT 'green',
  p_alerts jsonb DEFAULT '[]',
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot_id uuid;
  v_deployed_at timestamptz;
BEGIN
  -- Get deployment time
  SELECT deployed_at INTO v_deployed_at
  FROM ccip_changes
  WHERE change_id = p_change_id;
  
  -- Insert snapshot
  INSERT INTO ccip_monitoring_snapshots (
    change_id,
    snapshot_time,
    time_since_deploy,
    metrics,
    alert_level,
    alerts,
    notes
  ) VALUES (
    p_change_id,
    now(),
    CASE WHEN v_deployed_at IS NOT NULL THEN now() - v_deployed_at ELSE NULL END,
    p_metrics,
    p_alert_level,
    p_alerts,
    p_notes
  )
  RETURNING id INTO v_snapshot_id;
  
  RETURN v_snapshot_id;
END;
$$;

-- Insert the EQS Confidence Modifier change record
INSERT INTO ccip_changes (
  change_id,
  title,
  description,
  affected_components,
  severity,
  system_map_completed,
  logic_contract_completed,
  dry_run_completed,
  compatibility_check_completed,
  staged_deployment_completed,
  post_deploy_monitoring_completed,
  status,
  ccip_compliant,
  retroactive_documentation,
  deployed_at,
  monitoring_started_at,
  documentation_url,
  rollback_criteria
) VALUES (
  'EQS-CONF-MOD-001',
  'EQS Confidence Modifier Implementation',
  'Dynamic EQS threshold adjustment based on Alpha confidence level. Allows lower-confidence trades to execute with relaxed entry quality requirements while requiring higher quality for high-confidence trades.',
  jsonb_build_array(
    'src/config/alpha-identity.ts',
    'src/services/alpha-execution-planner.ts',
    'src/services/entry-qualified-execution-flow.ts',
    'src/brains/coordinator-alpha.ts'
  ),
  'medium',
  true,  -- system_map_completed (retroactive)
  true,  -- logic_contract_completed (retroactive)
  false, -- dry_run_completed (not done)
  true,  -- compatibility_check_completed (retroactive)
  false, -- staged_deployment_completed (deployed directly)
  true,  -- post_deploy_monitoring_completed (in progress)
  'monitoring',
  false, -- NOT CCIP compliant due to retroactive nature
  true,  -- retroactive_documentation
  now(), -- deployed_at (approximate)
  now(), -- monitoring_started_at
  '/EQS_CONFIDENCE_MODIFIER_CCIP_RETROACTIVE.md',
  jsonb_build_object(
    'immediate_rollback', jsonb_build_array(
      'Win rate drops below 35% for confidence >= 85%',
      'System crashes or errors spike',
      'Users report consistent execution failures',
      'Critical vulnerability discovered'
    ),
    'planned_rollback', jsonb_build_array(
      'Overall profitability decreases by >15%',
      'User satisfaction drops significantly',
      'Unintended gaming of system detected'
    )
  )
)
ON CONFLICT (change_id) DO UPDATE SET
  updated_at = now(),
  system_map_completed = EXCLUDED.system_map_completed,
  logic_contract_completed = EXCLUDED.logic_contract_completed,
  compatibility_check_completed = EXCLUDED.compatibility_check_completed,
  post_deploy_monitoring_completed = EXCLUDED.post_deploy_monitoring_completed;
