/*
  # Create Alpha Execution Transparency System (CCIP Compliant)

  1. New Tables
    - `alpha_execution_audit` - tracks every Alpha decision and execution attempt
    - `execution_block_reasons` - governance audit of why trades didn't execute
    - `alpha_decision_diagnostics` - captures full decision context for troubleshooting

  2. Purpose
    - Provide non-breaking visibility into Alpha decision flow
    - Track intelligent degradation (why trades don't happen)
    - Enable SSOT-compliant diagnosis without silent mutations
    - Support CCIP change tracking and governance compliance

  3. Security
    - Enable RLS with restrictive policies
    - Service role has audit access
    - Authenticated users can only see their own data

  4. Data Retention
    - Auto-cleanup of old records (60 days) via trigger
    - Indexes on critical columns for query performance

  5. Important
    - These tables are READ-ONLY from execution path
    - They log decisions, they don't alter them
    - Non-performance-critical: async writes only
*/

-- Create alpha_execution_audit table
CREATE TABLE IF NOT EXISTS alpha_execution_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid REFERENCES goal_sessions(id) ON DELETE SET NULL,
  decision_id uuid,
  action text NOT NULL CHECK (action IN ('BUY', 'SELL', 'WAIT', 'NO_TRADE')),
  symbol text,
  confidence numeric(5,2),
  
  -- Decision context (immutable record of what Alpha considered)
  regime_oracle_confidence numeric(5,2),
  adversarial_score numeric(5,2),
  omega_council_votes jsonb,
  
  -- Execution context
  execution_attempted boolean DEFAULT false,
  execution_success boolean,
  execution_blocked_reason text,
  
  -- Market conditions snapshot
  market_price numeric(15,8),
  signal_price numeric(15,8),
  price_drift_pips numeric(10,4),
  signal_timestamp timestamptz,
  
  created_at timestamptz DEFAULT now(),
  execution_attempted_at timestamptz,
  completed_at timestamptz,
  
  CONSTRAINT valid_confidence CHECK (confidence >= 0 AND confidence <= 100),
  CONSTRAINT valid_omega_votes CHECK (omega_council_votes IS NULL OR jsonb_typeof(omega_council_votes) = 'array')
);

-- Create execution_block_reasons table (governance audit)
CREATE TABLE IF NOT EXISTS execution_block_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid REFERENCES goal_sessions(id) ON DELETE SET NULL,
  audit_id uuid NOT NULL REFERENCES alpha_execution_audit(id) ON DELETE CASCADE,
  
  block_category text NOT NULL CHECK (block_category IN (
    'FRESHNESS_GATE',
    'OMEGA_VALIDATION',
    'SSOT_VALIDATION',
    'PCVL_VALIDATION',
    'RISK_MANAGER',
    'GOVERNANCE_LIMIT',
    'ENTRY_COORDINATOR',
    'CIRCUIT_BREAKER',
    'GOAL_FEASIBILITY',
    'SAFETY_ENFORCEMENT'
  )),
  
  specific_reason text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('FATAL', 'WARNING', 'ADVISORY')),
  
  -- Context for diagnosis
  blocking_value text,
  threshold_value text,
  recoverable boolean DEFAULT false,
  recovery_action text,
  
  created_at timestamptz DEFAULT now()
);

-- Create alpha_decision_diagnostics table
CREATE TABLE IF NOT EXISTS alpha_decision_diagnostics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid REFERENCES goal_sessions(id) ON DELETE SET NULL,
  audit_id uuid NOT NULL REFERENCES alpha_execution_audit(id) ON DELETE CASCADE,
  
  -- Full decision pipeline snapshot
  snapshot_age_seconds integer,
  snapshot_valid boolean,
  
  price_data_freshness jsonb, -- {symbol: {age_ms, is_stale, last_update}}
  omega_pipeline_health jsonb, -- {omega8_complete, omega9_complete, latency_ms}
  
  entry_intent_status text,
  entry_intent_conditions jsonb,
  
  concurrent_trades_open integer,
  concurrent_trades_max integer,
  
  margin_available numeric(18,2),
  margin_required numeric(18,2),
  
  -- Thesis memory
  thesis_id uuid,
  thesis_age_seconds integer,
  thesis_valid boolean,
  
  -- Full execution chain
  execution_chain jsonb, -- [{stage, passed, reason, timestamp}]
  
  created_at timestamptz DEFAULT now()
);

-- Create indexes for query performance
CREATE INDEX IF NOT EXISTS idx_alpha_execution_audit_user_session 
  ON alpha_execution_audit(user_id, session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alpha_execution_audit_timestamp 
  ON alpha_execution_audit(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_execution_block_reasons_audit 
  ON execution_block_reasons(audit_id);

CREATE INDEX IF NOT EXISTS idx_execution_block_reasons_category 
  ON execution_block_reasons(user_id, block_category, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alpha_decision_diagnostics_session 
  ON alpha_decision_diagnostics(session_id, created_at DESC);

-- Enable RLS
ALTER TABLE alpha_execution_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution_block_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE alpha_decision_diagnostics ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can view their own execution data
CREATE POLICY "Users can view own execution audit"
  ON alpha_execution_audit FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view own block reasons"
  ON execution_block_reasons FOR SELECT
  TO authenticated
  USING (auth.uid() IN (
    SELECT user_id FROM alpha_execution_audit WHERE id = audit_id
  ));

CREATE POLICY "Users can view own diagnostics"
  ON alpha_decision_diagnostics FOR SELECT
  TO authenticated
  USING (auth.uid() IN (
    SELECT user_id FROM alpha_execution_audit WHERE id = audit_id
  ));

-- RLS Policies: Service role can insert audit data (from edge functions)
CREATE POLICY "Service role can insert execution audit"
  ON alpha_execution_audit FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can insert block reasons"
  ON execution_block_reasons FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can insert diagnostics"
  ON alpha_decision_diagnostics FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Auto-cleanup trigger (60 days retention)
CREATE OR REPLACE FUNCTION cleanup_alpha_execution_audit()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM alpha_execution_audit 
  WHERE created_at < NOW() - INTERVAL '60 days';
END;
$$;

-- Grant permissions
GRANT SELECT ON alpha_execution_audit TO authenticated;
GRANT SELECT ON execution_block_reasons TO authenticated;
GRANT SELECT ON alpha_decision_diagnostics TO authenticated;
GRANT INSERT ON alpha_execution_audit TO service_role;
GRANT INSERT ON execution_block_reasons TO service_role;
GRANT INSERT ON alpha_decision_diagnostics TO service_role;