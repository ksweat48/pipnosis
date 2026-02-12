/*
  # Admin Manual Referral Linking RPC

  1. New Functions
    - `admin_link_referral` - Allows admin to manually link a referee to a referral code
      - Parameters: referee email, referral code
      - Validates both users exist
      - Prevents duplicate referrals
      - Creates audit trail in referral_state_audit

  2. Security
    - SECURITY DEFINER with admin-only check via user_profiles.is_admin
    - Full audit logging for accountability
*/

CREATE OR REPLACE FUNCTION admin_link_referral(
  p_referee_email TEXT,
  p_referral_code TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_admin_id UUID;
  v_referee_id UUID;
  v_referrer_id UUID;
  v_referral_id UUID;
  v_existing_link UUID;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM user_profiles WHERE id = v_admin_id AND is_admin = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Admin access required');
  END IF;

  SELECT au.id INTO v_referee_id
  FROM auth.users au
  WHERE au.email = p_referee_email;

  IF v_referee_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found: ' || p_referee_email);
  END IF;

  SELECT referrer_id, id INTO v_referrer_id, v_referral_id
  FROM club_referrals
  WHERE referral_code = p_referral_code
  LIMIT 1;

  IF v_referrer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Referral code not found: ' || p_referral_code);
  END IF;

  IF v_referrer_id = v_referee_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot link user to their own referral code');
  END IF;

  SELECT id INTO v_existing_link
  FROM club_referrals
  WHERE referee_id = v_referee_id
  LIMIT 1;

  IF v_existing_link IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User already has an active referral link');
  END IF;

  IF EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = v_referee_id AND referred_by_user_id IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'User already has referred_by_user_id set');
  END IF;

  UPDATE user_profiles
  SET referred_by_user_id = v_referrer_id,
      updated_at = NOW()
  WHERE id = v_referee_id;

  IF EXISTS (
    SELECT 1 FROM club_referrals
    WHERE id = v_referral_id AND referee_id IS NULL
  ) THEN
    UPDATE club_referrals
    SET referee_id = v_referee_id,
        referred_at = NOW(),
        updated_at = NOW()
    WHERE id = v_referral_id;
  ELSE
    INSERT INTO club_referrals (
      referrer_id, referee_id, referral_code, status,
      referred_at, commission_model
    ) VALUES (
      v_referrer_id, v_referee_id, p_referral_code, 'pending',
      NOW(), 'ongoing'
    );
  END IF;

  INSERT INTO referral_state_audit (
    referral_id,
    old_status, new_status,
    old_referee_id, new_referee_id,
    trigger_event, triggered_by,
    metadata
  ) VALUES (
    v_referral_id,
    'pending', 'pending',
    NULL, v_referee_id,
    'admin_manual_link',
    v_admin_id,
    jsonb_build_object(
      'admin_id', v_admin_id,
      'referee_email', p_referee_email,
      'referral_code', p_referral_code,
      'linked_at', NOW()
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'referee_id', v_referee_id,
    'referrer_id', v_referrer_id,
    'referral_code', p_referral_code,
    'message', 'Referral linked successfully'
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
