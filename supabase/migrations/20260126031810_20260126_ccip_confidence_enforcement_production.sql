/*
  # CCIP Confidence System Enforcement - Production Hardening

  **Purpose:** Add runtime enforcement to prevent confidence mismatches and ensure graceful degradation.

  **Changes:**
  1. Create confidence_enforcement_log table for real-time monitoring
  2. Create confidence degradation alerts for transparency
  3. Create RLS policies for governance compliance

  **Governance:**
  - All confidence calculations tracked with full audit trail
  - Execution failures logged with confidence state
  - Degradation alerts created for transparency
  - Service role can validate, users cannot override
*/

DO $$
BEGIN
  -- Create enforcement log table
  CREATE TABLE IF NOT EXISTS confidence_enforcement_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    trade_id uuid NOT NULL,
    session_id uuid,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Confidence values
    calculated_confidence numeric(5, 2),
    applied_confidence numeric(5, 2),
    execution_attempted boolean DEFAULT false,
    execution_success boolean,
    
    -- Enforcement details
    enforcement_rule text,
    enforcement_status text CHECK (enforcement_status IN ('passed', 'blocked', 'degraded')),
    enforcement_reason text,
    
    -- Penalty tracking
    total_penalties numeric(5, 2),
    penalty_breakdown jsonb,
    
    -- Auditing
    created_at timestamptz DEFAULT now(),
    event_timestamp timestamptz DEFAULT now(),
    source_service text,
    metadata jsonb DEFAULT '{}'::jsonb
  );

  -- Create confidence degradation alerts
  CREATE TABLE IF NOT EXISTS confidence_degradation_alerts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    trade_id uuid,
    
    alert_type text CHECK (alert_type IN ('high_penalty', 'execution_blocked', 'confidence_below_threshold', 'domain_violation')),
    severity text CHECK (severity IN ('info', 'warning', 'critical')),
    
    base_confidence numeric(5, 2),
    final_confidence numeric(5, 2),
    penalty_amount numeric(5, 2),
    
    alert_message text NOT NULL,
    recommended_action text,
    
    dismissed boolean DEFAULT false,
    dismissed_at timestamptz,
    
    created_at timestamptz DEFAULT now(),
    
    CONSTRAINT valid_confidence_range CHECK (base_confidence >= 0 AND base_confidence <= 100),
    CONSTRAINT valid_final_confidence CHECK (final_confidence >= 0 AND final_confidence <= 100)
  );

  -- Create indexes
  CREATE INDEX IF NOT EXISTS idx_confidence_enforcement_trade ON confidence_enforcement_log(trade_id);
  CREATE INDEX IF NOT EXISTS idx_confidence_enforcement_user ON confidence_enforcement_log(user_id);
  CREATE INDEX IF NOT EXISTS idx_confidence_enforcement_status ON confidence_enforcement_log(enforcement_status);
  CREATE INDEX IF NOT EXISTS idx_confidence_alerts_user ON confidence_degradation_alerts(user_id);
  CREATE INDEX IF NOT EXISTS idx_confidence_alerts_type ON confidence_degradation_alerts(alert_type);
  CREATE INDEX IF NOT EXISTS idx_confidence_alerts_severity ON confidence_degradation_alerts(severity);

  -- Enable RLS
  ALTER TABLE confidence_enforcement_log ENABLE ROW LEVEL SECURITY;
  ALTER TABLE confidence_degradation_alerts ENABLE ROW LEVEL SECURITY;

  -- RLS Policies for enforcement log
  CREATE POLICY "users_read_own_enforcement" ON confidence_enforcement_log
    FOR SELECT USING (user_id = auth.uid());
    
  CREATE POLICY "admins_read_all_enforcement" ON confidence_enforcement_log
    FOR SELECT USING (auth.jwt() ->> 'role' = 'admin');
    
  CREATE POLICY "service_role_write_enforcement" ON confidence_enforcement_log
    FOR INSERT TO service_role WITH CHECK (true);

  -- RLS Policies for degradation alerts
  CREATE POLICY "users_read_own_alerts" ON confidence_degradation_alerts
    FOR SELECT USING (user_id = auth.uid());
    
  CREATE POLICY "users_dismiss_own_alerts" ON confidence_degradation_alerts
    FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
    
  CREATE POLICY "admins_read_all_alerts" ON confidence_degradation_alerts
    FOR SELECT USING (auth.jwt() ->> 'role' = 'admin');
    
  CREATE POLICY "service_role_write_alerts" ON confidence_degradation_alerts
    FOR INSERT TO service_role WITH CHECK (true);

  -- Log the enforcement system creation
  INSERT INTO confidence_refactor_ccip_events (
    event_type, phase, component, description, impact_severity, actor, reason
  ) VALUES (
    'phase_start',
    'staged_deployment',
    'confidence_enforcement_production',
    'Production enforcement system initialized - all trade executions will be monitored',
    'high',
    'system',
    'Runtime confidence validation and graceful degradation'
  );

END $$;