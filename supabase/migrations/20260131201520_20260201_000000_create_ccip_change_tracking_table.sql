/*
  # CCIP Change Tracking Table (SSOT Governance)
  
  1. New Tables
    - `ccip_change_tracking` - Master audit log for all governance-tracked changes
      - Records all system changes that require CCIP compliance oversight
      - Enables forensic analysis of state mutations
      - Single source of truth for governance audit trail
      - Service role only (no client mutations)
  
  2. Security
    - Enable RLS: Service role exclusive write access
    - Authenticated users can read their own records
    - Admin users can read all records
    - Prevents accidental mutations from client side
  
  3. Performance
    - Indexes on user_id, operation_type, governance_log_id for fast lookups
    - Index on created_at for timeline queries
    - Composite index for user + operation_type queries
  
  4. Schema Design
    - operation_type: Categorical grouping (SESSION_CLOSURE, TRADE_EXECUTION, etc.)
    - table_name: Which table was modified (goal_sessions, trades, entry_intents)
    - record_id: FK to affected record
    - change_details: Full context of the change (jsonb)
    - governance_log_id: Unique tracking ID across the system
*/

CREATE TABLE IF NOT EXISTS ccip_change_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operation_type text NOT NULL,
  table_name text NOT NULL,
  record_id uuid NOT NULL,
  change_details jsonb NOT NULL DEFAULT '{}',
  governance_log_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_ccip_change_tracking_user_id 
  ON ccip_change_tracking(user_id);
CREATE INDEX IF NOT EXISTS idx_ccip_change_tracking_operation_type 
  ON ccip_change_tracking(operation_type);
CREATE INDEX IF NOT EXISTS idx_ccip_change_tracking_governance_log_id 
  ON ccip_change_tracking(governance_log_id);
CREATE INDEX IF NOT EXISTS idx_ccip_change_tracking_created_at 
  ON ccip_change_tracking(created_at);
CREATE INDEX IF NOT EXISTS idx_ccip_change_tracking_user_operation 
  ON ccip_change_tracking(user_id, operation_type);

-- Enable RLS
ALTER TABLE ccip_change_tracking ENABLE ROW LEVEL SECURITY;

-- Policy 1: Service role (backend) has full access for audit logging
CREATE POLICY "Service role full access to ccip_change_tracking"
  ON ccip_change_tracking
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Policy 2: Authenticated users can read only their own changes
CREATE POLICY "Users can read own ccip changes"
  ON ccip_change_tracking
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy 3: Admins can read all changes for compliance oversight
CREATE POLICY "Admins can read all ccip changes"
  ON ccip_change_tracking
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );
