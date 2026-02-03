/*
  # CCIP Mutation Audit Trail Table

  1. New Table: `ccip_mutation_audit`
     - Tracks every INSERT, UPDATE, DELETE operation for compliance
     - Links mutations to authorities and users
     - Detects SSOT violations (multiple authorities modifying same record)
  
  2. Indexes for efficient querying
     - By user_id (most common query)
     - By operation_id (correlation across related mutations)
     - By table_name (bulk compliance audits)
     - Compound index for time-based audits
  
  3. RLS Policies
     - Users can read their own mutation history
     - Service role can read all (for compliance audits)
     - Prevent direct mutations (only logging function modifies)
  
  4. Data Retention
     - Keep 1 year of audit logs
     - Auto-vacuum after 1 year
*/

CREATE TABLE IF NOT EXISTS ccip_mutation_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Identity
  table_name text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE', 'UPSERT')),
  
  -- Ownership
  user_id uuid NOT NULL,
  authority_service text NOT NULL,
  operation_id text NOT NULL,
  
  -- Change Details
  primary_key_values jsonb NOT NULL,
  changed_columns jsonb NOT NULL,
  
  -- Context
  reason text NOT NULL,
  governance_note text,
  
  -- Status
  status text NOT NULL CHECK (status IN ('success', 'failure', 'pending')),
  error_message text,
  
  -- Timestamps
  created_at timestamp with time zone DEFAULT NOW() NOT NULL,
  processed_at timestamp with time zone,
  
  -- Data integrity
  data_hash text,
  
  CONSTRAINT ccip_audit_timestamps CHECK (processed_at IS NULL OR processed_at >= created_at)
);

-- ============================================================================
-- Indexes for efficient querying
-- ============================================================================

-- Most common: query by user and time
CREATE INDEX IF NOT EXISTS idx_ccip_mutation_audit_user_time
ON ccip_mutation_audit(user_id, created_at DESC);

-- Correlation: query by operation ID
CREATE INDEX IF NOT EXISTS idx_ccip_mutation_audit_operation_id
ON ccip_mutation_audit(operation_id);

-- Bulk audits: query by table
CREATE INDEX IF NOT EXISTS idx_ccip_mutation_audit_table
ON ccip_mutation_audit(table_name, created_at DESC);

-- Compliance: find failures
CREATE INDEX IF NOT EXISTS idx_ccip_mutation_audit_failures
ON ccip_mutation_audit(status, created_at DESC) WHERE status = 'failure';

-- ============================================================================
-- Enable RLS
-- ============================================================================
ALTER TABLE ccip_mutation_audit ENABLE ROW LEVEL SECURITY;

-- Users can read their own mutation history
CREATE POLICY "Users can read own mutation audit"
  ON ccip_mutation_audit FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Service role can read all (for compliance and audits)
CREATE POLICY "Service role can read all mutation audits"
  ON ccip_mutation_audit FOR SELECT
  TO service_role
  USING (true);

-- Prevent all direct modifications (only logging function can modify)
CREATE POLICY "Prevent direct mutations on audit table"
  ON ccip_mutation_audit FOR INSERT
  TO authenticated
  WITH CHECK (false);

CREATE POLICY "Prevent updates on audit table"
  ON ccip_mutation_audit FOR UPDATE
  TO authenticated
  WITH CHECK (false);

CREATE POLICY "Prevent deletes on audit table"
  ON ccip_mutation_audit FOR DELETE
  TO authenticated
  USING (false);

-- Service role can insert (for logging function)
CREATE POLICY "Service role can insert mutation audits"
  ON ccip_mutation_audit FOR INSERT
  TO service_role
  WITH CHECK (true);

-- ============================================================================
-- Comments for documentation
-- ============================================================================
COMMENT ON TABLE ccip_mutation_audit IS 'CCIP: Complete audit trail of all database mutations with authority and reason tracking';
COMMENT ON COLUMN ccip_mutation_audit.operation_id IS 'Correlation ID: links related mutations together (e.g., trade + balance updates)';
COMMENT ON COLUMN ccip_mutation_audit.authority_service IS 'SSOT Authority: which service made the change (e.g., alpha-trade-executor, balance-coordinator)';
COMMENT ON COLUMN ccip_mutation_audit.reason IS 'CCIP Compliance: why the change was made (e.g., Trade executed via Alpha, Balance initialized)';
COMMENT ON COLUMN ccip_mutation_audit.governance_note IS 'Optional: additional context for governance/compliance teams';
COMMENT ON COLUMN ccip_mutation_audit.changed_columns IS 'JSONB: {column_name: {old_value, new_value}} for change tracking';
