/*
  # CCIP: Club Membership Payment Pipeline Governance Fix

  ## Summary
  Addresses critical gaps identified in the pre-launch audit of the Club membership
  payment pipeline. All changes are SSOT, CCIP, and Governance compliant.

  ## Problems Fixed

  ### 1. membership_upgrade purchaseType not recognised by checkout function
  The frontend correctly sends purchaseType='membership_upgrade' for tier upgrades,
  but the Netlify checkout function only checked purchaseType='membership' when
  determining success/cancel redirect URLs. This caused upgrade checkouts to redirect
  to /credits instead of /club on completion.
  Fix: Applied in stripe-create-checkout-session.ts (type union + isMembership guard).

  ### 2. verify-membership-purchase returned wrong RPC field names
  The verify endpoint read total_tokens_awarded, tokens_locked, tokens_available,
  tiers_awarded_count, and previous_tier_level from the RPC response, but the
  grant_club_membership RPC only returns: success, membership_id, tier_level,
  tokens_awarded, is_upgrade, tier_breakdown. The tier_name is also absent.
  The frontend upgrade success message therefore displayed "Upgraded from undefined".
  Fix: Applied in verify-membership-purchase.ts (aligned field reads, added pre-grant
  fromTierName lookup, post-grant pkg name lookup, idempotency path for webhook
  already-processed scenario).

  ### 3. club-membership-service.grantMembership bypassed SSOT RPC
  The service method duplicated membership creation, token allocation, token locking,
  and referral commission logic that all lives authoritatively in grant_club_membership.
  It also rejected upgrades with "User already has a membership", which contradicts
  the RPC's upgrade capability.
  Fix: Service method now delegates entirely to grant_club_membership RPC.

  ## Database Changes

  ### New: validate_membership_package_stripe_config function
  A callable validation helper that confirms an active membership package has a
  stripe_price_id before a checkout can proceed. Used as a governance guard.

  ### New: stripe_price_id NOT NULL constraint on active packages
  Prevents new active packages from being inserted without a stripe_price_id,
  which would silently cause checkout failures.

  ## Security
  No RLS changes. All existing policies remain in force.
  The validation function is SECURITY DEFINER so service-role callers can check
  without needing direct table access.

  ## CCIP Compliance
  - System Map: stripe-create-checkout-session -> stripe-webhook -> grant_club_membership RPC
  - Logic Contract: purchaseType in ('membership','membership_upgrade') routes to /club
  - Dry-Run: verify endpoint tested against actual RPC field names
  - Compatibility: No breaking changes to existing webhook or RPC signatures
  - Staged Deployment: Frontend + Netlify functions deploy atomically via Netlify build
  - Post-Deploy Verification: Use verify_membership_payment_pipeline_health() below
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- Guard: prevent active packages without stripe_price_id
-- Only enforced for new inserts/updates; existing NULL rows (inactive) unaffected.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'club_membership_packages'
      AND constraint_name = 'active_packages_require_stripe_price_id'
  ) THEN
    ALTER TABLE club_membership_packages
      ADD CONSTRAINT active_packages_require_stripe_price_id
      CHECK (
        is_active = false OR stripe_price_id IS NOT NULL
      );
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper: validate a package has a stripe_price_id before checkout
-- Called by governance monitors; returns error detail for logging.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION validate_membership_package_stripe_config(
  p_package_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg RECORD;
BEGIN
  SELECT id, name, tier_level, is_active, stripe_price_id
  INTO v_pkg
  FROM club_membership_packages
  WHERE id = p_package_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Package not found', 'package_id', p_package_id);
  END IF;

  IF NOT v_pkg.is_active THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Package is not active', 'package_id', p_package_id, 'name', v_pkg.name);
  END IF;

  IF v_pkg.stripe_price_id IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Package has no stripe_price_id configured', 'package_id', p_package_id, 'name', v_pkg.name, 'tier_level', v_pkg.tier_level);
  END IF;

  RETURN jsonb_build_object('valid', true, 'package_id', p_package_id, 'name', v_pkg.name, 'tier_level', v_pkg.tier_level, 'stripe_price_id', v_pkg.stripe_price_id);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Post-deploy verification: run after deployment to confirm pipeline integrity
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION verify_membership_payment_pipeline_health()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active_packages_without_price INTEGER;
  v_active_package_count INTEGER;
  v_grant_rpc_exists BOOLEAN;
  v_result JSONB;
BEGIN
  SELECT COUNT(*) INTO v_active_packages_without_price
  FROM club_membership_packages
  WHERE is_active = true AND stripe_price_id IS NULL;

  SELECT COUNT(*) INTO v_active_package_count
  FROM club_membership_packages
  WHERE is_active = true;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'grant_club_membership'
  ) INTO v_grant_rpc_exists;

  v_result := jsonb_build_object(
    'healthy', (v_active_packages_without_price = 0 AND v_grant_rpc_exists),
    'active_packages', v_active_package_count,
    'active_packages_missing_stripe_price_id', v_active_packages_without_price,
    'grant_club_membership_rpc_exists', v_grant_rpc_exists,
    'checked_at', now()
  );

  RETURN v_result;
END;
$$;

-- Run health check immediately for post-deploy verification
DO $$
DECLARE
  v_health JSONB;
BEGIN
  v_health := verify_membership_payment_pipeline_health();
  IF NOT (v_health->>'healthy')::BOOLEAN THEN
    RAISE WARNING '[CCIP] Membership payment pipeline health check FAILED: %', v_health;
  ELSE
    RAISE NOTICE '[CCIP] Membership payment pipeline health check PASSED: %', v_health;
  END IF;
END $$;
