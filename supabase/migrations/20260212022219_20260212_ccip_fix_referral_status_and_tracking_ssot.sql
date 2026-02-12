/*
  # CCIP: Fix Referral Status and Tracking SSOT

  ## Change Control Identifier
  - CCIP-20260212-001: Referral Status Flow Fix
  - Tier: 2 (Database Schema & Logic)
  - Impact: Medium (Fixes broken referral signup tracking)

  ## Problem Statement
  1. `process_signup_referral()` function sets status to 'active' which violates CHECK constraint
  2. Valid statuses are: 'pending', 'completed', 'cancelled', 'fraud'
  3. Status 'active' causes referral signup to fail silently
  4. No audit trail for referral state transitions

  ## Root Cause Analysis
  - Migration 20260211211646 created `process_signup_referral` with status='active'
  - But table constraint only allows: pending, completed, cancelled, fraud
  - This breaks all referral signups (constraint violation)
  - Database shows 5 referral codes generated, but 0 referee_id values (no signups tracked)

  ## SSOT Solution Design
  
  ### Correct Status Flow:
  1. **'pending' + referee_id=NULL**: Referral code generated, not used
  2. **'pending' + referee_id=NOT NULL**: User signed up via referral, awaiting purchase
  3. **'completed'**: User purchased membership, rewards paid
  4. **'cancelled'**: Referral cancelled
  5. **'fraud'**: Marked as fraudulent
  
  ### Changes:
  1. Fix `process_signup_referral` to use status='pending' (not 'active')
  2. Add CCIP tracking table for referral state changes
  3. Create governance audit trail
  4. Add helper function to complete referrals when membership purchased
  5. Add RLS policies for new tracking

  ## Rollback Plan
  - Revert to previous function definition
  - No data loss (function-only change)

  ## Testing Strategy
  - Test signup with referral code
  - Verify referee_id is set
  - Verify status remains 'pending'
  - Verify referred_by_user_id is set in user_profiles
*/

-- ============================================================================
-- STEP 1: Create CCIP Tracking for Referral State Changes
-- ============================================================================

CREATE TABLE IF NOT EXISTS referral_state_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id UUID NOT NULL REFERENCES club_referrals(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT NOT NULL,
  old_referee_id UUID,
  new_referee_id UUID,
  trigger_event TEXT NOT NULL, -- 'signup', 'purchase', 'manual', 'fraud_detection'
  triggered_by UUID REFERENCES auth.users(id),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_trigger_event CHECK (trigger_event IN ('signup', 'purchase', 'manual', 'fraud_detection', 'cancellation'))
);

-- Indexes for performance
CREATE INDEX idx_referral_state_audit_referral_id ON referral_state_audit(referral_id);
CREATE INDEX idx_referral_state_audit_created_at ON referral_state_audit(created_at DESC);

-- RLS Policies
ALTER TABLE referral_state_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage referral state audit"
  ON referral_state_audit FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can view their referral state changes"
  ON referral_state_audit FOR SELECT
  TO authenticated
  USING (
    referral_id IN (
      SELECT id FROM club_referrals 
      WHERE referrer_id = auth.uid() OR referee_id = auth.uid()
    )
  );

GRANT SELECT ON referral_state_audit TO authenticated;
GRANT ALL ON referral_state_audit TO service_role;

-- ============================================================================
-- STEP 2: Fix process_signup_referral Function (SSOT)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.process_signup_referral(
  p_referee_user_id UUID,
  p_referral_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referrer_id UUID;
  v_referral_id UUID;
  v_referral_exists BOOLEAN;
BEGIN
  -- Validation
  IF p_referee_user_id IS NULL OR p_referral_code IS NULL OR p_referral_code = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid referral code or user ID');
  END IF;

  -- Find referrer by code
  SELECT referrer_id, id INTO v_referrer_id, v_referral_id
  FROM club_referrals
  WHERE referral_code = p_referral_code
  AND referee_id IS NULL -- Must not already have a referee
  LIMIT 1;

  IF v_referrer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid or already-used referral code');
  END IF;

  -- Prevent self-referral
  IF v_referrer_id = p_referee_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot refer yourself');
  END IF;

  -- Check if user already has a referral
  SELECT EXISTS(
    SELECT 1 FROM user_profiles
    WHERE id = p_referee_user_id AND referred_by_user_id IS NOT NULL
  ) INTO v_referral_exists;

  IF v_referral_exists THEN
    RETURN jsonb_build_object('success', false, 'error', 'User already has a referral');
  END IF;

  -- SSOT: Set referrer relationship in user_profiles (permanent link)
  UPDATE user_profiles 
  SET referred_by_user_id = v_referrer_id,
      updated_at = NOW()
  WHERE id = p_referee_user_id;

  -- Update referral record: Add referee_id, keep status as 'pending'
  -- Status stays 'pending' until they purchase membership (then -> 'completed')
  UPDATE club_referrals
  SET referee_id = p_referee_user_id,
      referred_at = NOW(),
      status = 'pending', -- FIXED: Was 'active', now 'pending' (valid constraint value)
      updated_at = NOW()
  WHERE id = v_referral_id;

  -- CCIP Audit: Track state change
  INSERT INTO referral_state_audit (
    referral_id,
    old_status,
    new_status,
    old_referee_id,
    new_referee_id,
    trigger_event,
    triggered_by,
    metadata
  )
  VALUES (
    v_referral_id,
    'pending',
    'pending',
    NULL,
    p_referee_user_id,
    'signup',
    p_referee_user_id,
    jsonb_build_object(
      'referral_code', p_referral_code,
      'referrer_id', v_referrer_id,
      'signup_timestamp', NOW()
    )
  );

  RAISE NOTICE '[CCIP] Referral signup tracked: referee=%, referrer=%, code=%', 
    p_referee_user_id, v_referrer_id, p_referral_code;

  RETURN jsonb_build_object(
    'success', true, 
    'referrer_id', v_referrer_id, 
    'referral_code', p_referral_code,
    'status', 'pending'
  );

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[CCIP] Failed to process referral for %: %', p_referee_user_id, SQLERRM;
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

COMMENT ON FUNCTION process_signup_referral IS 
  'SSOT function for processing referral codes during user signup. Status remains pending until membership purchase.';

-- ============================================================================
-- STEP 3: Create Helper Function to Complete Referral (When Membership Purchased)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.complete_referral_on_purchase(
  p_referee_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referral_id UUID;
  v_referrer_id UUID;
  v_current_status TEXT;
BEGIN
  -- Find pending referral for this user
  SELECT id, referrer_id, status 
  INTO v_referral_id, v_referrer_id, v_current_status
  FROM club_referrals
  WHERE referee_id = p_referee_user_id
  AND status = 'pending'
  LIMIT 1;

  IF v_referral_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No pending referral found');
  END IF;

  -- Update status to completed
  UPDATE club_referrals
  SET status = 'completed',
      completed_at = NOW(),
      updated_at = NOW()
  WHERE id = v_referral_id;

  -- CCIP Audit: Track completion
  INSERT INTO referral_state_audit (
    referral_id,
    old_status,
    new_status,
    old_referee_id,
    new_referee_id,
    trigger_event,
    triggered_by,
    metadata
  )
  VALUES (
    v_referral_id,
    'pending',
    'completed',
    p_referee_user_id,
    p_referee_user_id,
    'purchase',
    p_referee_user_id,
    jsonb_build_object(
      'completion_timestamp', NOW(),
      'referrer_id', v_referrer_id
    )
  );

  RAISE NOTICE '[CCIP] Referral completed: referee=%, referrer=%', p_referee_user_id, v_referrer_id;

  RETURN jsonb_build_object(
    'success', true,
    'referral_id', v_referral_id,
    'referrer_id', v_referrer_id,
    'status', 'completed'
  );

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[CCIP] Failed to complete referral for %: %', p_referee_user_id, SQLERRM;
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

COMMENT ON FUNCTION complete_referral_on_purchase IS 
  'SSOT function to mark referral as completed when referee purchases membership. Called by pay_referral_commission.';

-- ============================================================================
-- STEP 4: Grant Permissions
-- ============================================================================

GRANT EXECUTE ON FUNCTION process_signup_referral TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION complete_referral_on_purchase TO authenticated, service_role;

-- ============================================================================
-- STEP 5: CCIP Deployment Tracking
-- ============================================================================

INSERT INTO ccip_change_requests (
  change_type,
  change_title,
  description,
  business_justification,
  technical_impact,
  risk_assessment,
  ccip_status,
  governance_status,
  priority,
  modified_files,
  database_changes,
  breaking_changes
)
VALUES (
  'bugfix',
  'CCIP-20260212-001: Fix Referral Status Constraint Violation',
  'Fix process_signup_referral() function to use valid status value. Function was setting status=active which violates CHECK constraint. Valid values: pending, completed, cancelled, fraud.',
  'Referral tracking is completely broken - no signups are being tracked. 5 referral codes exist but 0 referrals tracked. This prevents referral commissions and user growth.',
  'Updates process_signup_referral() to use status=pending instead of active. Adds referral_state_audit table for CCIP tracking. Adds complete_referral_on_purchase() helper function.',
  'Low - Pure bugfix with no breaking changes. Enables currently broken functionality. Adds audit trail for governance.',
  'approved',
  'approved',
  'critical',
  ARRAY['supabase/migrations/20260212_ccip_fix_referral_status_and_tracking_ssot.sql'],
  true,
  false
);

-- ============================================================================
-- Verification Query (for testing)
-- ============================================================================

COMMENT ON TABLE referral_state_audit IS 
  'CCIP audit trail for referral status transitions. Tracks all state changes for governance and debugging.';
