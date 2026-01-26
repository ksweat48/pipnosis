/*
  # Confidence System Refactor - CCIP Change Tracking

  **Purpose:** Track all confidence calculation changes during refactor to maintain SSOT compliance and Governance auditability.

  **Change Summary:**
  - Consolidate regime/volatility/session penalties into RegimeOracle (single authority)
  - Remove consensus bonus (vote strength already encoded in base confidence)
  - Implement explicit confidence ceilings for extreme conditions (no silent inflation)
  - Enforce domain isolation (no penalty double-counting)
  - Create degradation audit trail (trades degrade intelligently, not silently)

  **New Tables:**
  - `confidence_refactor_ccip_events` - Every confidence calculation change logged
  - `confidence_calculation_audit` - Pre/post confidence values with all modifier sources
  - `penalty_domain_isolation_log` - Track penalty domain ownership and prevent overlaps

  **Architecture Changes:**
  1. RegimeOracle owns: volatility regime, execution reliability (spread/liquidity), risk climate
  2. Session Advisor remains separate: max -5%, purely advisory
  3. EQS: mild curve, cap at -15%
  4. Narrative: cap at -12%
  5. Adversarial: cap at -10% (no overlap with regime)
  6. Final clamping: [0, 100]
  7. Execute threshold: 60%

  **Governance Compliance:**
  - All changes logged with timestamp, actor, reason, effect
  - Trades that degrade due to confidence changes get explicit notifications
  - System cannot silently block or mutate confidence
  - Every penalty attributed to domain owner (SSOT)

  **CCIP Phases Included:**
  - Phase 1: System mapping (complete)
  - Phase 2: Logic contracts (this migration)
  - Phase 3: Dry-run (in-app validation on next deploy)
  - Phase 4: Compatibility check (audit trail validation)
  - Phase 5: Staged deployment (gradual rollout with monitoring)
*/

DO $$
BEGIN
  -- Create confidence refactor CCIP events table
  CREATE TABLE IF NOT EXISTS confidence_refactor_ccip_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type text NOT NULL CHECK (event_type IN ('phase_start', 'logic_change', 'compatibility_check', 'deployment', 'degradation_alert')),
    phase text NOT NULL CHECK (phase IN ('mapping', 'logic_contract', 'dry_run', 'compatibility', 'staged_deployment')),
    component text NOT NULL,
    description text NOT NULL,
    previous_value jsonb,
    new_value jsonb,
    impact_severity text CHECK (impact_severity IN ('low', 'medium', 'high', 'critical')),
    affected_trades_estimate int,
    actor text DEFAULT 'system',
    reason text,
    created_at timestamptz DEFAULT now(),
    metadata jsonb DEFAULT '{}'::jsonb
  );

  CREATE TABLE IF NOT EXISTS confidence_calculation_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    trade_id uuid NOT NULL,
    session_id uuid,
    calculation_timestamp timestamptz DEFAULT now(),
    
    -- Base confidence (from Omega)
    base_confidence_value numeric(5, 2),
    omega_votes_detail jsonb,
    
    -- Rewards (additive)
    total_reward_bonus numeric(5, 2),
    reward_sources jsonb,
    
    -- Penalties (each domain isolated)
    eqs_penalty numeric(5, 2),
    narrative_penalty numeric(5, 2),
    regime_oracle_penalty numeric(5, 2),
    regime_oracle_ceiling numeric(5, 2),
    adversarial_penalty numeric(5, 2),
    session_advisory_penalty numeric(5, 2),
    
    -- Penalty details for audit
    penalty_domain_owners jsonb,
    penalty_isolation_check boolean,
    
    -- Final calculation
    pre_cap_confidence numeric(5, 2),
    risk_mode_floor numeric(5, 2),
    post_risk_mode_cap numeric(5, 2),
    final_clamped_confidence numeric(5, 2),
    
    -- Execution decision
    execution_threshold numeric(5, 2),
    passes_threshold boolean,
    execution_decision text CHECK (execution_decision IN ('EXECUTE', 'WAIT', 'BLOCK', 'DEGRADE')),
    
    -- Governance metadata
    governance_compliant boolean,
    ccip_phase text,
    audit_notes text,
    
    created_at timestamptz DEFAULT now(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS penalty_domain_isolation_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    trade_id uuid NOT NULL,
    session_id uuid,
    calculation_id uuid REFERENCES confidence_calculation_audit(id),
    
    -- Domain ownership
    domain_name text NOT NULL,
    domain_owner text NOT NULL,
    
    -- Penalty info
    penalty_amount numeric(5, 2),
    penalty_reason text,
    
    -- Isolation verification
    overlapping_domains text[],
    isolation_violation boolean,
    violation_reason text,
    
    -- Governance
    flagged_for_review boolean,
    review_notes text,
    
    created_at timestamptz DEFAULT now(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE
  );

  -- Create indexes for performance
  CREATE INDEX IF NOT EXISTS idx_confidence_refactor_events_phase ON confidence_refactor_ccip_events(phase);
  CREATE INDEX IF NOT EXISTS idx_confidence_refactor_events_component ON confidence_refactor_ccip_events(component);
  CREATE INDEX IF NOT EXISTS idx_confidence_audit_trade ON confidence_calculation_audit(trade_id);
  CREATE INDEX IF NOT EXISTS idx_confidence_audit_user ON confidence_calculation_audit(user_id);
  CREATE INDEX IF NOT EXISTS idx_confidence_audit_threshold ON confidence_calculation_audit(passes_threshold);
  CREATE INDEX IF NOT EXISTS idx_penalty_isolation_domain ON penalty_domain_isolation_log(domain_name, domain_owner);
  CREATE INDEX IF NOT EXISTS idx_penalty_isolation_violation ON penalty_domain_isolation_log(isolation_violation);

  -- Enable RLS
  ALTER TABLE confidence_refactor_ccip_events ENABLE ROW LEVEL SECURITY;
  ALTER TABLE confidence_calculation_audit ENABLE ROW LEVEL SECURITY;
  ALTER TABLE penalty_domain_isolation_log ENABLE ROW LEVEL SECURITY;

  -- RLS Policies: Admins can read all, service role can write audit data
  CREATE POLICY "admins_read_ccip_events" ON confidence_refactor_ccip_events
    FOR SELECT TO authenticated USING (auth.jwt() ->> 'role' = 'admin');
    
  CREATE POLICY "service_role_write_ccip_events" ON confidence_refactor_ccip_events
    FOR INSERT TO service_role WITH CHECK (true);

  CREATE POLICY "users_read_own_confidence_audit" ON confidence_calculation_audit
    FOR SELECT USING (user_id = auth.uid() OR auth.jwt() ->> 'role' = 'admin');
    
  CREATE POLICY "service_role_write_confidence_audit" ON confidence_calculation_audit
    FOR INSERT TO service_role WITH CHECK (true);

  CREATE POLICY "users_read_own_penalty_isolation" ON penalty_domain_isolation_log
    FOR SELECT USING (user_id = auth.uid() OR auth.jwt() ->> 'role' = 'admin');
    
  CREATE POLICY "service_role_write_penalty_isolation" ON penalty_domain_isolation_log
    FOR INSERT TO service_role WITH CHECK (true);

  -- Log the start of CCIP change tracking
  INSERT INTO confidence_refactor_ccip_events (
    event_type, phase, component, description, impact_severity, actor, reason
  ) VALUES (
    'phase_start',
    'logic_contract',
    'confidence_system_ccip',
    'Confidence refactor CCIP tracking system initialized - all changes will be audited',
    'high',
    'system',
    'Foundation for SSOT-compliant confidence calculation refactor'
  );

END $$;