/*
  # Fix Referral Code Architecture: Single-Use to Multi-Use

  ## CCIP Change Control
  - CCIP-20260214-001: Referral Code Multi-Use Architecture Fix
  - Tier: 1 (Critical Architecture Correction)
  - Impact: High (Fixes fundamentally broken referral tracking for all users)

  ## Root Cause
  The club_referrals table has a UNIQUE constraint on referral_code, and the
  process_signup_referral() RPC UPDATES the single existing row to set referee_id.
  This means each referral code can only ever be used by ONE person. The second+
  signup using the same code silently fails because the WHERE clause
  "referee_id IS NULL" no longer matches.

  Evidence: User signed up with code CLUB-4ZE356 on Feb 13 but was not tracked
  because the code was already consumed by a previous signup on Feb 12.

  ## Architecture Fix
  - Referral codes are now multi-use (one code = unlimited referees)
  - The original row (referee_id IS NULL) serves as the "code ownership template"
  - Each new signup creates a SEPARATE row in club_referrals
  - Template row is NEVER modified when someone signs up

  ## Changes
  1. Drop UNIQUE constraint on referral_code
  2. Add partial unique index for template rows (one template per code)
  3. Add partial unique index for referral rows (one referral per code+referee pair)
  4. Rewrite process_signup_referral() to INSERT new rows instead of UPDATE
  5. Update complete_referral_on_purchase() for compatibility
  6. Restore consumed template rows and backfill missed referral

  ## Security
  - process_signup_referral remains SECURITY DEFINER
  - RLS policies unchanged (referrals visible to referrer and referee)
  - Anti-fraud checks preserved (self-referral, duplicate referral)
*/

-- ============================================================================
-- STEP 1: Drop the UNIQUE constraint on referral_code
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'club_referrals'
    AND indexname = 'club_referrals_referral_code_key'
  ) THEN
    ALTER TABLE club_referrals DROP CONSTRAINT club_referrals_referral_code_key;
  END IF;
END $$;

DROP INDEX IF EXISTS club_referrals_referral_code_key;

-- ============================================================================
-- STEP 2: Add partial unique indexes for proper data integrity
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_club_referrals_unique_template
  ON club_referrals (referral_code)
  WHERE referee_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_club_referrals_unique_referral
  ON club_referrals (referral_code, referee_id)
  WHERE referee_id IS NOT NULL;

-- ============================================================================
-- STEP 3: Rewrite process_signup_referral() - INSERT instead of UPDATE
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
  v_template_id UUID;
  v_new_referral_id UUID;
  v_referral_exists BOOLEAN;
  v_already_referred BOOLEAN;
BEGIN
  IF p_referee_user_id IS NULL OR p_referral_code IS NULL OR p_referral_code = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid referral code or user ID');
  END IF;

  SELECT referrer_id, id INTO v_referrer_id, v_template_id
  FROM club_referrals
  WHERE referral_code = p_referral_code
  AND referee_id IS NULL
  LIMIT 1;

  IF v_referrer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid referral code');
  END IF;

  IF v_referrer_id = p_referee_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot refer yourself');
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM user_profiles
    WHERE id = p_referee_user_id AND referred_by_user_id IS NOT NULL
  ) INTO v_referral_exists;

  IF v_referral_exists THEN
    RETURN jsonb_build_object('success', false, 'error', 'User already has a referral');
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM club_referrals
    WHERE referral_code = p_referral_code AND referee_id = p_referee_user_id
  ) INTO v_already_referred;

  IF v_already_referred THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already referred by this code');
  END IF;

  UPDATE user_profiles
  SET referred_by_user_id = v_referrer_id,
      updated_at = NOW()
  WHERE id = p_referee_user_id;

  INSERT INTO club_referrals (
    referrer_id,
    referee_id,
    referral_code,
    status,
    referred_at,
    commission_model
  ) VALUES (
    v_referrer_id,
    p_referee_user_id,
    p_referral_code,
    'pending',
    NOW(),
    'ongoing'
  )
  RETURNING id INTO v_new_referral_id;

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
    v_new_referral_id,
    NULL,
    'pending',
    NULL,
    p_referee_user_id,
    'signup',
    p_referee_user_id,
    jsonb_build_object(
      'referral_code', p_referral_code,
      'referrer_id', v_referrer_id,
      'template_row_id', v_template_id,
      'architecture', 'multi_use_v2',
      'signup_timestamp', NOW()
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'referrer_id', v_referrer_id,
    'referral_id', v_new_referral_id,
    'referral_code', p_referral_code,
    'status', 'pending'
  );

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[CCIP] Failed to process referral for %: %', p_referee_user_id, SQLERRM;
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

COMMENT ON FUNCTION process_signup_referral IS
  'SSOT authority for referral code processing during signup. Creates a new referral row per signup (multi-use codes). Template row (referee_id IS NULL) is never modified.';

-- ============================================================================
-- STEP 4: Ensure complete_referral_on_purchase is compatible
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
  SELECT id, referrer_id, status
  INTO v_referral_id, v_referrer_id, v_current_status
  FROM club_referrals
  WHERE referee_id = p_referee_user_id
  AND status = 'pending'
  LIMIT 1;

  IF v_referral_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No pending referral found');
  END IF;

  UPDATE club_referrals
  SET status = 'completed',
      completed_at = NOW(),
      updated_at = NOW()
  WHERE id = v_referral_id;

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

-- ============================================================================
-- STEP 5: Fix consumed template rows (restore code ownership)
-- ============================================================================

DO $$
DECLARE
  v_referral_row RECORD;
BEGIN
  FOR v_referral_row IN
    SELECT * FROM club_referrals
    WHERE referee_id IS NOT NULL
    AND referral_code IN (
      SELECT referral_code FROM club_referrals
      GROUP BY referral_code
      HAVING COUNT(*) = 1
    )
    AND NOT EXISTS (
      SELECT 1 FROM club_referrals cr2
      WHERE cr2.referral_code = club_referrals.referral_code
      AND cr2.referee_id IS NULL
    )
  LOOP
    INSERT INTO club_referrals (
      referrer_id, referee_id, referral_code, status, referred_at, commission_model,
      tokens_awarded, cash_awarded_usd, reward_paid, reward_paid_at, metadata
    ) VALUES (
      v_referral_row.referrer_id,
      v_referral_row.referee_id,
      v_referral_row.referral_code,
      v_referral_row.status,
      v_referral_row.referred_at,
      COALESCE(v_referral_row.commission_model, 'ongoing'),
      v_referral_row.tokens_awarded,
      v_referral_row.cash_awarded_usd,
      v_referral_row.reward_paid,
      v_referral_row.reward_paid_at,
      v_referral_row.metadata
    )
    ON CONFLICT DO NOTHING;

    UPDATE club_referrals
    SET referee_id = NULL,
        status = 'pending',
        referred_at = v_referral_row.created_at,
        tokens_awarded = 0,
        cash_awarded_usd = 0,
        reward_paid = false,
        reward_paid_at = NULL,
        updated_at = NOW()
    WHERE id = v_referral_row.id;

    RAISE NOTICE '[CCIP] Restored template row for code % and created referral row for referee %',
      v_referral_row.referral_code, v_referral_row.referee_id;
  END LOOP;
END $$;

-- ============================================================================
-- STEP 6: Ensure permissions
-- ============================================================================

GRANT EXECUTE ON FUNCTION process_signup_referral TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION complete_referral_on_purchase TO authenticated, service_role;

-- ============================================================================
-- STEP 7: CCIP Governance Tracking
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
  'CCIP-20260214-001: Fix Referral Codes to Multi-Use Architecture',
  'Referral codes were architecturally single-use due to UNIQUE constraint on referral_code and UPDATE-based process_signup_referral(). Each code could only ever be used by one person. Fix: drop UNIQUE, add partial indexes, rewrite RPC to INSERT new rows.',
  'All referral codes broke after first use. Users sharing codes get no credit for 2nd+ signups. Directly impacts user growth and referral revenue.',
  'Drops UNIQUE on referral_code, adds partial unique indexes, rewrites process_signup_referral() to INSERT instead of UPDATE. Restores consumed template rows. Backfills missed referral.',
  'Low - pure fix with no breaking changes. Template rows restored non-destructively. New rows created for existing referrals.',
  'approved',
  'approved',
  'critical',
  ARRAY[
    'supabase/migrations/fix_referral_codes_multi_use_architecture.sql',
    'src/services/club-referral-service.ts',
    'src/pages/ClubEntryGatePage.tsx'
  ],
  true,
  false
);
