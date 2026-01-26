/*
  # CCIP-Compliant Audit System for Silent Multiplier Removal

  This migration establishes the governance infrastructure to track and audit
  all goal feasibility decisions, ensuring SSOT compliance and transparency.

  ## Summary of Changes

  This migration creates a single source of truth for goal feasibility auditing:
  - All reduction mechanisms are explicitly tracked (not hidden)
  - Each decision includes suppressed mechanisms and applied advisories
  - User choice is recorded and auditable
  - Allows post-hoc analysis of any goal recommendation

  ## New Tables

  1. `goal_target_audit` - Complete audit trail of goal feasibility analysis
     Tracks: requested goal, mechanisms evaluated, advisories applied, user choice
  
  2. `feasibility_mechanism_detail` - Detailed breakdown of each mechanism evaluated
     Tracks: which floors passed/failed, exact values, why applied

  ## Security

  - Enable RLS on all tables
  - Only authenticated users can read own audit records
  - Only service role can write during trade execution
  - Governance team can read all for compliance audits

  ## SSOT Philosophy

  - Every goal decision is logged with full context
  - No silent mutations - all reductions explicit
  - Audit trail allows tracing back "why was goal reduced"
  - Supports post-trade learning and compliance verification
*/

-- Create goal_target_audit table (SSOT: full audit trail of goal decisions)
CREATE TABLE IF NOT EXISTS public.goal_target_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_session_id UUID NOT NULL REFERENCES public.goal_sessions(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  
  -- Original request
  goal_requested DECIMAL(20, 2) NOT NULL,
  goal_recommended DECIMAL(20, 2) NOT NULL,
  goal_user_choice DECIMAL(20, 2),
  
  -- Mechanisms evaluated (for transparency)
  mechanisms_evaluated TEXT[] DEFAULT '{}',
  mechanisms_suppressed TEXT[] DEFAULT '{}',
  mechanisms_applied TEXT[] DEFAULT '{}',
  
  -- Decision context
  atr_value DECIMAL(20, 4),
  atr_typical DECIMAL(20, 4),
  atr_multiplier_from_typical DECIMAL(5, 2),
  session_liquidity TEXT,
  current_spread DECIMAL(20, 4),
  account_balance DECIMAL(20, 2),
  
  -- Advisor results (transparent)
  min_goal_retention_met BOOLEAN,
  meaningful_trade_floor_details JSONB,
  volatility_advisory_applied BOOLEAN,
  session_liquidity_advisory_applied BOOLEAN,
  goal_size_advisory_applied BOOLEAN,
  
  -- User interaction
  user_choice TEXT CHECK (user_choice IN ('accept_recommended', 'accept_full', 'accept_custom', 'wait')),
  user_choice_value DECIMAL(20, 2),
  
  -- Governance tracking
  suppressed_mechanisms_reason JSONB,
  reduction_breakdown JSONB,
  governance_notes TEXT,
  trade_consequence_notes TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create meaningful_trade_floor_details view for transparent floor tracking
CREATE TABLE IF NOT EXISTS public.feasibility_mechanism_detail (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id UUID NOT NULL REFERENCES public.goal_target_audit(id) ON DELETE CASCADE,
  
  -- Floor or mechanism name
  mechanism_name TEXT NOT NULL,
  mechanism_type TEXT NOT NULL CHECK (mechanism_type IN ('FLOOR', 'ADVISORY', 'MULTIPLIER', 'SIZE_CHECK')),
  
  -- Evaluation result
  evaluated BOOLEAN DEFAULT true,
  passed BOOLEAN DEFAULT false,
  
  -- Values for audit
  threshold_value DECIMAL(20, 2),
  actual_value DECIMAL(20, 2),
  unit TEXT,
  
  -- Why it was applied/suppressed
  applied_reason TEXT,
  suppressed_reason TEXT,
  
  -- Impact if applied
  impact_factor DECIMAL(5, 2),
  impact_dollar_amount DECIMAL(20, 2),
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.goal_target_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feasibility_mechanism_detail ENABLE ROW LEVEL SECURITY;

-- RLS Policies for goal_target_audit
CREATE POLICY "Users can view own audit records"
  ON public.goal_target_audit
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert audit records"
  ON public.goal_target_audit
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Governance team can view all audits for compliance"
  ON public.goal_target_audit
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- RLS Policies for feasibility_mechanism_detail
CREATE POLICY "Users can view own mechanism details"
  ON public.feasibility_mechanism_detail
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.goal_target_audit
      WHERE id = audit_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "Service role can insert mechanism details"
  ON public.feasibility_mechanism_detail
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Governance team can view all mechanism details"
  ON public.feasibility_mechanism_detail
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND is_admin = true
    )
    AND EXISTS (
      SELECT 1 FROM public.goal_target_audit
      WHERE id = audit_id
    )
  );

-- Indexes for performance
CREATE INDEX idx_goal_target_audit_user_created ON public.goal_target_audit(user_id, created_at DESC);
CREATE INDEX idx_goal_target_audit_session ON public.goal_target_audit(goal_session_id);
CREATE INDEX idx_feasibility_mechanism_detail_audit ON public.feasibility_mechanism_detail(audit_id);

-- Trigger to update goal_target_audit.updated_at
CREATE OR REPLACE FUNCTION update_goal_target_audit_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER goal_target_audit_update_timestamp
BEFORE UPDATE ON public.goal_target_audit
FOR EACH ROW
EXECUTE FUNCTION update_goal_target_audit_timestamp();
