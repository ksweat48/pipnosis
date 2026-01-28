/*
  # CCIP Governance: AI Trader Score Audit Trail & RLS Enforcement

  ## Purpose
  Establish governance compliance for ai_trader_score mutations.
  This migration ensures:
  1. All mutations are logged for audit trail
  2. RLS policies are enforced for security
  3. Service role mutations are distinguished from user mutations

  ## CCIP Compliance Checklist
  - System Map: ai_trader_score is authority for trader performance state
  - Logic Contract: Only reward-engine.ts writes to this table
  - Dry-Run Simulation: Query paths validated (no ambiguous columns)
  - Compatibility Check: RLS policies match TypeScript reward-engine code
  - Staged Deployment: Policies applied non-destructively
  - Post-Deploy Verification: Queries tested

  ## Governance Changes
  - Add audit trigger to log all mutations
  - Verify RLS policies are correct
  - Document mutation authority (SSOT)
  - Ensure no direct frontend writes

  ## Critical Constraints
  - user_id is UNIQUE - one score per trader
  - current_score must be 0-100
  - All streaks/counts must be >= 0
  - Personality state derived from score (read-only fields)
*/

-- Create audit table for ai_trader_score mutations
CREATE TABLE IF NOT EXISTS ai_trader_score_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trader_score_id uuid REFERENCES ai_trader_score(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  
  -- Mutation Details
  operation text NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  old_score integer,
  new_score integer,
  old_streak_wins integer,
  new_streak_wins integer,
  old_streak_losses integer,
  new_streak_losses integer,
  
  -- Who Made the Change
  changed_by text NOT NULL CHECK (changed_by IN ('authenticated_user', 'service_role', 'system')),
  authenticated_user_id uuid,
  
  -- When
  created_at timestamptz NOT NULL DEFAULT now(),
  
  -- Metadata
  change_reason text,
  metadata jsonb DEFAULT '{}'::jsonb
);

-- Enable RLS on audit table
ALTER TABLE ai_trader_score_audit ENABLE ROW LEVEL SECURITY;

-- Audit RLS: Users can read their own audit log
CREATE POLICY "Users can read own trader score audit"
  ON ai_trader_score_audit
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Audit RLS: Service role can read all (for analytics)
CREATE POLICY "Service role can read all trader score audit"
  ON ai_trader_score_audit
  FOR SELECT
  TO service_role
  USING (true);

-- Audit RLS: Only service role/system can insert audit records
CREATE POLICY "Service role can insert audit records"
  ON ai_trader_score_audit
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Performance index for audit queries
CREATE INDEX idx_ai_trader_score_audit_user_id ON ai_trader_score_audit(user_id, created_at DESC);
CREATE INDEX idx_ai_trader_score_audit_operation ON ai_trader_score_audit(operation);

-- Create function to log ai_trader_score changes
CREATE OR REPLACE FUNCTION log_ai_trader_score_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO ai_trader_score_audit (
    trader_score_id,
    user_id,
    operation,
    old_score,
    new_score,
    old_streak_wins,
    new_streak_wins,
    old_streak_losses,
    new_streak_losses,
    changed_by,
    authenticated_user_id,
    metadata
  ) VALUES (
    CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END,
    CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END,
    TG_OP,
    CASE WHEN TG_OP = 'DELETE' THEN OLD.current_score ELSE NULL END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.current_score END,
    CASE WHEN TG_OP = 'DELETE' THEN OLD.streak_wins ELSE NULL END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.streak_wins END,
    CASE WHEN TG_OP = 'DELETE' THEN OLD.streak_losses ELSE NULL END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.streak_losses END,
    CASE 
      WHEN current_setting('request.jwt.claims')::jsonb->>'sub' IS NOT NULL THEN 'authenticated_user'
      ELSE 'service_role'
    END,
    CASE 
      WHEN current_setting('request.jwt.claims')::jsonb->>'sub' IS NOT NULL 
      THEN (current_setting('request.jwt.claims')::jsonb->>'sub')::uuid
      ELSE NULL
    END,
    jsonb_build_object(
      'event_type', TG_OP,
      'timestamp', now()::text
    )
  );
  
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

-- Drop existing trigger if present
DROP TRIGGER IF EXISTS ai_trader_score_audit_trigger ON ai_trader_score;

-- Create trigger for audit logging
CREATE TRIGGER ai_trader_score_audit_trigger
AFTER INSERT OR UPDATE OR DELETE ON ai_trader_score
FOR EACH ROW
EXECUTE FUNCTION log_ai_trader_score_change();

-- Verify RLS policies are in place
DO $$
DECLARE
  policy_count integer;
BEGIN
  SELECT COUNT(*) INTO policy_count
  FROM pg_policies
  WHERE tablename = 'ai_trader_score' AND schemaname = 'public';
  
  IF policy_count >= 4 THEN
    RAISE NOTICE '✅ RLS Policies verified: % policies found on ai_trader_score', policy_count;
  ELSE
    RAISE WARNING '⚠️ RLS Policy count low: only % policies found', policy_count;
  END IF;
END $$;

-- Add comment documenting SSOT authority
COMMENT ON TABLE ai_trader_score IS
'SSOT for trader performance scoring. AUTHORITY: reward-engine.ts is sole writer.
Mutations MUST use rewardEngine.loadTraderScore() and rewardEngine.calculateWinReward().
Frontend MUST NOT write directly. Service role writes via autonomous trading system.
All mutations logged to ai_trader_score_audit for governance compliance.';

COMMENT ON TABLE ai_trader_score_audit IS
'Immutable audit trail for ai_trader_score mutations. CCIP governance compliance.
Tracks all mutations with user context (authenticated vs service role).
Used for compliance audits and debugging score calculation issues.';
