/*
  # Constraint Feasibility Governance Tracking (CCIP Compliance)
  
  ## Overview
  Tracks when Omega-9 detects infeasible constraint pairs (minTP > maxTP).
  This is critical for governance and debugging the constraint generation system.
  
  ## New Tables
  - `constraint_feasibility_audit` - Records when constraints are infeasible
  
  ## Purpose
  1. Governance: Track constraint conflicts for compliance audit trail
  2. Debugging: Identify patterns in infeasible constraint generation
  3. Learning: Feed back into feasibility resolver for improvements
  4. Authority: Document that Alpha retains full authority despite conflicts
  
  ## Security
  - RLS enabled: Only authenticated users see their own audit records
  - Service role: System can insert during Omega-9 processing
  - No direct user data exposure
  
  ## Important Notes
  - This table is informational, not punitive
  - Infeasible constraints are ADVISORY, not BLOCKING
  - Alpha still retains full authority to decide
  - This enables governance compliance with CCIP protocol
*/

CREATE TABLE IF NOT EXISTS constraint_feasibility_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  session_id uuid,
  
  -- Context
  symbol text NOT NULL,
  trade_style text NOT NULL,
  entry_price numeric NOT NULL,
  direction text NOT NULL,
  
  -- Constraint details
  min_tp_required numeric NOT NULL,
  max_tp_available numeric NOT NULL,
  min_rr_required numeric NOT NULL,
  max_rr_achievable numeric NOT NULL,
  
  -- Conflict analysis
  conflict_source text NOT NULL, -- 'SESSION_TIME' | 'MARKET_ATR'
  gap_pips numeric NOT NULL,
  rr_reduction_needed numeric NOT NULL, -- percentage
  severity text NOT NULL, -- 'MINOR' | 'MODERATE' | 'SEVERE'
  
  -- Alpha decision tracking
  alpha_decision_made boolean DEFAULT false,
  alpha_accepted_reduced_rr boolean,
  alpha_changed_style boolean,
  alpha_skipped_trade boolean,
  alpha_rationale text,
  
  -- System tracking
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  CONSTRAINT valid_direction CHECK (direction IN ('BUY', 'SELL')),
  CONSTRAINT valid_conflict_source CHECK (conflict_source IN ('SESSION_TIME', 'MARKET_ATR', 'NONE')),
  CONSTRAINT valid_severity CHECK (severity IN ('MINOR', 'MODERATE', 'SEVERE')),
  CONSTRAINT valid_decision_logic CHECK (
    (alpha_decision_made = false AND alpha_accepted_reduced_rr IS NULL) OR
    (alpha_decision_made = true AND (alpha_accepted_reduced_rr IS NOT NULL OR alpha_changed_style IS NOT NULL OR alpha_skipped_trade IS NOT NULL))
  ),
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Enable RLS
ALTER TABLE constraint_feasibility_audit ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read their own audit records
CREATE POLICY "Users can read own constraint audit"
  ON constraint_feasibility_audit FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy: Service role can insert audit records (during Omega-9 processing)
CREATE POLICY "Service role can insert constraint audit"
  ON constraint_feasibility_audit FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Policy: Users can update their own decision records
CREATE POLICY "Users can update own decision records"
  ON constraint_feasibility_audit FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Index for efficient queries
CREATE INDEX IF NOT EXISTS idx_constraint_audit_user_created ON constraint_feasibility_audit(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_constraint_audit_symbol ON constraint_feasibility_audit(symbol);
CREATE INDEX IF NOT EXISTS idx_constraint_audit_severity ON constraint_feasibility_audit(severity);
CREATE INDEX IF NOT EXISTS idx_constraint_audit_conflict_source ON constraint_feasibility_audit(conflict_source);

-- Index for Alpha decision tracking
CREATE INDEX IF NOT EXISTS idx_constraint_audit_decision ON constraint_feasibility_audit(alpha_decision_made, alpha_accepted_reduced_rr);

COMMENT ON TABLE constraint_feasibility_audit IS 'Governance audit trail for constraint feasibility conflicts. Records when Omega-9 detects infeasible constraint pairs and tracks Alpha decisions. CCIP compliance: Authority tracking and change management.';
COMMENT ON COLUMN constraint_feasibility_audit.conflict_source IS 'Why constraints are infeasible: SESSION_TIME (not enough time for TP) | MARKET_ATR (ATR insufficient for R:R) | NONE (feasible)';
COMMENT ON COLUMN constraint_feasibility_audit.severity IS 'MINOR: <25% R:R reduction | MODERATE: 25-50% | SEVERE: >50%';
COMMENT ON COLUMN constraint_feasibility_audit.alpha_decision_made IS 'Whether Alpha saw this advisory and made a conscious decision';
COMMENT ON COLUMN constraint_feasibility_audit.alpha_rationale IS 'Alpha''s reasoning for accepting reduced R:R, changing style, or skipping trade';
