/*
  # Add Lot Sizing Fallback Audit Logging

  ## Purpose
  Track when goal-aware lot sizing falls back to simple pip calculation (lacking proper conversion).
  This provides governance visibility into SSOT violations and data flow issues.

  ## Changes
  1. Add lot_sizing_audit_log table to capture fallback usage
  2. Add columns to track:
     - Whether goal-aware lot sizing was triggered
     - Whether coordinator returned valid data
     - Whether fallback calculation was used
     - Reason for fallback (missing session data, coordinator error, invalid result)
  
  ## CCIP Compliance
  - Governance tracking enabled for all lot sizing decisions
  - Audit trail for debugging SSOT data flow issues
  - No business logic changes - audit only
*/

CREATE TABLE IF NOT EXISTS lot_sizing_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  goal_session_id uuid NOT NULL REFERENCES goal_sessions(id) ON DELETE CASCADE,
  trade_id uuid REFERENCES goal_session_trades(id) ON DELETE SET NULL,
  
  -- Lot Sizing Decision Metadata
  session_had_target_value boolean NOT NULL,
  session_had_current_progress boolean NOT NULL,
  coordinator_invoked boolean NOT NULL,
  coordinator_succeeded boolean NOT NULL,
  coordinator_decision_id uuid,
  
  -- Fallback Tracking
  used_fallback_calculation boolean NOT NULL,
  fallback_reason text,
  
  -- Expected Profit Tracking (SSOT verification)
  coordinator_expected_profit numeric,
  fallback_expected_profit numeric,
  actual_recorded_profit numeric,
  
  -- Metadata
  symbol text NOT NULL,
  entry_price numeric NOT NULL,
  take_profit numeric NOT NULL,
  lot_size numeric NOT NULL,
  
  created_at timestamptz DEFAULT now() NOT NULL,
  
  CONSTRAINT fallback_reason_required_when_used CHECK (
    (used_fallback_calculation = false) OR (fallback_reason IS NOT NULL)
  )
);

-- Enable RLS
ALTER TABLE lot_sizing_audit_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Only users can view their own audit logs (for debugging), service role can insert for governance
CREATE POLICY "Users can view own lot sizing audit logs"
  ON lot_sizing_audit_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert audit logs"
  ON lot_sizing_audit_log FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can view all audit logs"
  ON lot_sizing_audit_log FOR SELECT
  TO service_role
  USING (true);

-- Index for performance
CREATE INDEX idx_lot_sizing_audit_log_session ON lot_sizing_audit_log(goal_session_id);
CREATE INDEX idx_lot_sizing_audit_log_user ON lot_sizing_audit_log(user_id);
CREATE INDEX idx_lot_sizing_audit_log_fallback ON lot_sizing_audit_log(used_fallback_calculation) WHERE used_fallback_calculation = true;
