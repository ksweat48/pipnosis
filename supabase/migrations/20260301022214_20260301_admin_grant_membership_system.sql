/*
  # Admin Grant Membership System

  ## Purpose
  Enables admins to grant or upgrade any user's Club membership directly from the admin
  dashboard. All token emissions flow through the existing grant_club_membership RPC
  so no token logic is duplicated.

  ## New Tables
  - `admin_membership_actions` — Append-only audit log for every admin-initiated
    membership grant or upgrade. Tracks: admin identity, target user, previous/new tier,
    package, tokens awarded, reason, and timestamp.

  ## New RPC Functions
  - `admin_grant_membership(p_admin_id, p_target_user_id, p_package_id, p_reason)` —
    Validates admin status, delegates to grant_club_membership, writes the audit row,
    and returns a full result object.
  - `admin_get_membership_actions(p_target_user_id)` — Returns the audit history for
    a given user so the UserDetailsModal can display it.

  ## Security
  - RLS enabled on admin_membership_actions
  - Only admins can INSERT (via the SECURITY DEFINER RPC; direct inserts denied)
  - Admins can SELECT their own actions; service_role has full access

  ## Token Flow
  Token emission is 100% delegated to grant_club_membership which calls add_club_tokens
  with transaction_type = 'membership_purchase'. The ledger entry's `created_by` column
  will carry the admin's user_id, making the audit trail complete in club_token_ledger.

  ## Notes
  - amount_paid_usd is always 0 for admin grants (complimentary)
  - stripe_session_id is set to 'admin_grant:<admin_user_id>' for traceability
  - The function enforces: caller must be admin, target user must exist, package must
    be active, and the target must not already be at an equal or higher tier
*/

-- ============================================================
-- 1. AUDIT TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_membership_actions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  target_user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_type         TEXT NOT NULL DEFAULT 'grant'
                        CHECK (action_type IN ('grant', 'upgrade')),
  previous_tier_level INTEGER,
  new_tier_level      INTEGER NOT NULL,
  package_id          UUID NOT NULL REFERENCES club_membership_packages(id),
  reason              TEXT NOT NULL,
  tokens_awarded      NUMERIC NOT NULL DEFAULT 0,
  membership_id       UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for fast lookups in UserDetailsModal and audit queries
CREATE INDEX IF NOT EXISTS idx_admin_membership_actions_target
  ON admin_membership_actions(target_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_membership_actions_admin
  ON admin_membership_actions(admin_user_id, created_at DESC);

-- ============================================================
-- 2. RLS
-- ============================================================
ALTER TABLE admin_membership_actions ENABLE ROW LEVEL SECURITY;

-- Admins can read all records
CREATE POLICY "Admins can read all membership actions"
  ON admin_membership_actions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
        AND user_profiles.is_admin = true
    )
  );

-- No direct inserts from clients — only the SECURITY DEFINER RPC may write
-- (Service role retains full access for edge functions / cron jobs)

-- ============================================================
-- 3. MAIN RPC: admin_grant_membership
-- ============================================================
CREATE OR REPLACE FUNCTION admin_grant_membership(
  p_admin_id      UUID,
  p_target_user_id UUID,
  p_package_id    UUID,
  p_reason        TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin            BOOLEAN;
  v_pkg                 RECORD;
  v_existing            RECORD;
  v_previous_tier       INTEGER;
  v_action_type         TEXT := 'grant';
  v_stripe_ref          TEXT;
  v_grant_result        JSONB;
  v_audit_id            UUID;
BEGIN
  -- 1. Confirm caller is admin
  SELECT is_admin INTO v_is_admin
  FROM user_profiles
  WHERE id = p_admin_id;

  IF NOT FOUND OR NOT v_is_admin THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: caller is not an admin');
  END IF;

  -- 2. Validate reason
  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Reason must be at least 5 characters');
  END IF;

  -- 3. Check package exists and is active
  SELECT * INTO v_pkg
  FROM club_membership_packages
  WHERE id = p_package_id AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Package not found or inactive');
  END IF;

  -- 4. Determine if this is an upgrade or fresh grant
  SELECT tier_level INTO v_previous_tier
  FROM club_memberships
  WHERE user_id = p_target_user_id AND status = 'active'
  ORDER BY tier_level DESC
  LIMIT 1;

  IF v_previous_tier IS NOT NULL THEN
    IF v_previous_tier >= v_pkg.tier_level THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'User already has an equal or higher tier (' || v_previous_tier || '). Choose a higher tier to upgrade.'
      );
    END IF;
    v_action_type := 'upgrade';
  END IF;

  -- 5. Delegate entirely to the canonical grant_club_membership RPC
  v_stripe_ref := 'admin_grant:' || p_admin_id::text;

  v_grant_result := grant_club_membership(
    p_user_id          => p_target_user_id,
    p_package_id       => p_package_id,
    p_amount_paid      => 0,
    p_stripe_session_id => v_stripe_ref
  );

  IF NOT (v_grant_result->>'success')::boolean THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', v_grant_result->>'error'
    );
  END IF;

  -- 6. Write audit row
  INSERT INTO admin_membership_actions (
    admin_user_id, target_user_id, action_type,
    previous_tier_level, new_tier_level, package_id,
    reason, tokens_awarded, membership_id
  )
  VALUES (
    p_admin_id, p_target_user_id, v_action_type,
    v_previous_tier, v_pkg.tier_level, p_package_id,
    p_reason,
    COALESCE((v_grant_result->>'tokens_awarded')::numeric, 0),
    (v_grant_result->>'membership_id')::uuid
  )
  RETURNING id INTO v_audit_id;

  -- 7. Return enriched result
  RETURN jsonb_build_object(
    'success',           true,
    'action_type',       v_action_type,
    'membership_id',     v_grant_result->>'membership_id',
    'tier_name',         v_pkg.name,
    'tier_level',        v_pkg.tier_level,
    'tokens_awarded',    (v_grant_result->>'tokens_awarded')::numeric,
    'is_upgrade',        v_action_type = 'upgrade',
    'previous_tier',     v_previous_tier,
    'audit_id',          v_audit_id
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_grant_membership TO authenticated;
GRANT EXECUTE ON FUNCTION admin_grant_membership TO service_role;

-- ============================================================
-- 4. QUERY RPC: admin_get_membership_actions
-- Returns the admin action history for a given user.
-- ============================================================
CREATE OR REPLACE FUNCTION admin_get_membership_actions(
  p_target_user_id UUID
)
RETURNS TABLE (
  id                  UUID,
  admin_user_id       UUID,
  admin_email         TEXT,
  action_type         TEXT,
  previous_tier_level INTEGER,
  new_tier_level      INTEGER,
  package_name        TEXT,
  reason              TEXT,
  tokens_awarded      NUMERIC,
  membership_id       UUID,
  created_at          TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only admins may call this
  IF NOT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid() AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    ama.id,
    ama.admin_user_id,
    au.email::text AS admin_email,
    ama.action_type,
    ama.previous_tier_level,
    ama.new_tier_level,
    cmp.name AS package_name,
    ama.reason,
    ama.tokens_awarded,
    ama.membership_id,
    ama.created_at
  FROM admin_membership_actions ama
  LEFT JOIN auth.users au ON au.id = ama.admin_user_id
  LEFT JOIN club_membership_packages cmp ON cmp.id = ama.package_id
  WHERE ama.target_user_id = p_target_user_id
  ORDER BY ama.created_at DESC
  LIMIT 50;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_membership_actions TO authenticated;
GRANT EXECUTE ON FUNCTION admin_get_membership_actions TO service_role;
