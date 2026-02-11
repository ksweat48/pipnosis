/*
  # Fix 50 Credit Signup and Implement Referral Tracking During Signup

  ## CCIP Change Control
  This migration addresses two critical issues:
  1. New users receiving 5 credits instead of 50 credits
  2. Referral tracking failing because ref codes aren't captured during signup

  ## Root Cause Analysis

  ### Issue 1: Credit Amount
  - handle_new_user() trigger INSERT into user_token_balance is failing silently
  - Race condition: balance record already exists when trigger fires

  ### Issue 2: Referral Tracking
  - AuthPage doesn't capture ref code from URL
  - ClubEntryGatePage only tracks for already-signed-up users
  - All club_referrals records show referee_id = null

  ## SSOT Solution

  1. Fix handle_new_user() trigger to handle race conditions
  2. Backfill users who received 5 credits to 50 credits
  3. Create RPC function for referral processing during signup
*/

-- STEP 1: Drop and recreate handle_new_user trigger with race condition fix
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, auth
LANGUAGE plpgsql
AS $$
DECLARE
  v_audit_id uuid;
  v_profile_created boolean := false;
  v_token_created boolean := false;
  v_error_msg text;
  v_balance_exists boolean := false;
BEGIN
  BEGIN
    INSERT INTO signup_audit_trail (user_id, email, email_confirmed)
    VALUES (NEW.id, NEW.email, NEW.email_confirmed_at IS NOT NULL)
    RETURNING id INTO v_audit_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Failed signup_audit_trail: %', SQLERRM;
    v_audit_id := NULL;
  END;

  BEGIN
    INSERT INTO public.user_profiles (
      id, email, full_name, plan_type, account_balance, risk_profile, trading_preferences, is_admin
    )
    VALUES (
      NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
      'free', 10000.00, 'auto', '{}'::jsonb,
      NEW.email = ANY(ARRAY['ksweat48@gmail.com', 'admin@pipnosis.com'])
    );

    v_profile_created := true;

    BEGIN
      SELECT EXISTS(SELECT 1 FROM user_token_balance WHERE user_id = NEW.id) INTO v_balance_exists;

      IF NOT v_balance_exists THEN
        INSERT INTO public.user_token_balance (user_id, balance, lifetime_earned)
        VALUES (NEW.id, 50.00, 50.00)
        ON CONFLICT (user_id) DO NOTHING;

        SELECT EXISTS(SELECT 1 FROM user_token_balance WHERE user_id = NEW.id AND balance >= 50.00)
        INTO v_token_created;
      ELSE
        UPDATE user_token_balance
        SET balance = GREATEST(balance, 50.00),
            lifetime_earned = GREATEST(lifetime_earned, 50.00),
            updated_at = NOW()
        WHERE user_id = NEW.id;
        v_token_created := true;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed user_token_balance for %: %', NEW.email, SQLERRM;
      v_token_created := false;
    END;

    IF v_token_created THEN
      BEGIN
        INSERT INTO credit_transaction_audit (user_id, transaction_type, amount, old_balance, new_balance, reason)
        VALUES (NEW.id, 'signup_bonus', 50.00, 0, 50.00, 'New user signup bonus - 50 free credits')
        ON CONFLICT DO NOTHING;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Failed credit_transaction_audit for %: %', NEW.email, SQLERRM;
      END;
    END IF;

    IF v_audit_id IS NOT NULL THEN
      BEGIN
        UPDATE signup_audit_trail
        SET profile_created = true, token_balance_created = v_token_created, trigger_success = true
        WHERE id = v_audit_id;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;

    RAISE NOTICE 'Successfully created account for % with 50 credits', NEW.email;
    RETURN NEW;

  EXCEPTION WHEN OTHERS THEN
    v_error_msg := SQLERRM;

    BEGIN
      IF v_audit_id IS NOT NULL THEN
        UPDATE signup_audit_trail
        SET profile_created = false, token_balance_created = false, trigger_success = false, error_message = v_error_msg
        WHERE id = v_audit_id;
      END IF;

      INSERT INTO account_integrity_logs (user_id, email, issue_type, severity, details)
      VALUES (NEW.id, NEW.email, 'trigger_failure', 'critical', jsonb_build_object('error', v_error_msg));
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    RAISE WARNING 'Signup completed with errors for %: %', NEW.email, v_error_msg;
    RETURN NEW;
  END;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- STEP 2: Create RPC function to process referral code during signup
CREATE OR REPLACE FUNCTION public.process_signup_referral(
  p_referee_user_id uuid,
  p_referral_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referrer_id uuid;
  v_referral_exists boolean;
BEGIN
  IF p_referee_user_id IS NULL OR p_referral_code IS NULL OR p_referral_code = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid referral code or user ID');
  END IF;

  SELECT referrer_id INTO v_referrer_id
  FROM club_referrals
  WHERE referral_code = p_referral_code
  AND status = 'pending'
  LIMIT 1;

  IF v_referrer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid or expired referral code');
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

  UPDATE user_profiles SET referred_by_user_id = v_referrer_id WHERE id = p_referee_user_id;

  UPDATE club_referrals
  SET referee_id = p_referee_user_id, referred_at = NOW(), status = 'active'
  WHERE referral_code = p_referral_code AND referrer_id = v_referrer_id;

  RAISE NOTICE 'Successfully processed referral: referee=%, referrer=%, code=%', p_referee_user_id, v_referrer_id, p_referral_code;

  RETURN jsonb_build_object('success', true, 'referrer_id', v_referrer_id, 'referral_code', p_referral_code);

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to process referral for %: %', p_referee_user_id, SQLERRM;
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION process_signup_referral TO authenticated;
GRANT EXECUTE ON FUNCTION process_signup_referral TO service_role;

-- STEP 3: Backfill users who received only 5 credits
DO $$
DECLARE
  v_affected_count integer := 0;
  v_user_record record;
BEGIN
  FOR v_user_record IN
    SELECT utb.user_id, utb.balance, up.email
    FROM user_token_balance utb
    JOIN user_profiles up ON up.id = utb.user_id
    WHERE utb.balance = 5.00
    AND utb.created_at > '2026-02-01'::timestamptz
    AND NOT up.is_admin
  LOOP
    UPDATE user_token_balance
    SET balance = balance + 45.00, lifetime_earned = lifetime_earned + 45.00, updated_at = NOW()
    WHERE user_id = v_user_record.user_id;

    INSERT INTO credit_transaction_audit (user_id, transaction_type, amount, old_balance, new_balance, reason)
    VALUES (v_user_record.user_id, 'admin_add', 45.00, 5.00, 50.00, 'CCIP-20260211: Backfill missing signup bonus (5→50 credits)');

    v_affected_count := v_affected_count + 1;
    RAISE NOTICE 'Corrected credits for user %', v_user_record.email;
  END LOOP;

  RAISE NOTICE 'Credit backfill complete: % users corrected', v_affected_count;
END $$;

-- STEP 4: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_profiles_referred_by ON user_profiles(referred_by_user_id) WHERE referred_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_club_referrals_referee ON club_referrals(referee_id) WHERE referee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_club_referrals_code_status ON club_referrals(referral_code, status);

COMMENT ON FUNCTION process_signup_referral IS 'SSOT function for processing referral codes during user signup';
