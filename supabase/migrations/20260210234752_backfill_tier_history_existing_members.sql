/*
  # Backfill Tier History for Existing Members

  ## Summary
  Populates the club_membership_tier_history table with records for existing members.
  This ensures existing members are credited ONLY for the tier they purchased, preventing
  retroactive cumulative bonuses they didn't pay for.

  ## Business Rules
  - Existing members keep their current token balances (no changes)
  - Tier history records their current tier only
  - Future upgrades will use the cumulative system correctly
  - Idempotent: safe to run multiple times (checks for existing records)

  ## SSOT Compliance
  - Creates historical records matching current membership state
  - Uses purchased_at timestamp for awarded_at accuracy
  - Links to actual membership_id for audit trail

  ## CCIP Reference
  See: CUMULATIVE_TIER_TOKENS_CCIP_20260210.md - Phase 2: Data Backfill
*/

-- ============================================================
-- PART 1: Backfill Tier History for Active Memberships
-- ============================================================

-- Insert tier history records for all active memberships
-- Only insert if no history exists yet (idempotent)
INSERT INTO club_membership_tier_history (
  user_id,
  tier_level,
  tier_name,
  tokens_awarded,
  membership_id,
  awarded_at,
  created_at
)
SELECT
  cm.user_id,
  cm.tier_level,
  pkg.name as tier_name,
  pkg.initial_token_allocation as tokens_awarded,
  cm.id as membership_id,
  cm.purchased_at as awarded_at,
  now() as created_at
FROM club_memberships cm
INNER JOIN club_membership_packages pkg ON pkg.id = cm.package_id
WHERE cm.status = 'active'
  -- Only insert if no history record exists for this user+tier combination
  AND NOT EXISTS (
    SELECT 1 FROM club_membership_tier_history th
    WHERE th.user_id = cm.user_id
    AND th.tier_level = cm.tier_level
  )
ON CONFLICT (user_id, tier_level) DO NOTHING;

-- ============================================================
-- PART 2: Update Membership Records with Cumulative Token Count
-- ============================================================

-- For existing members, set cumulative_tokens_awarded to match their current tier only
-- This reflects what they actually received (not cumulative bonuses)
UPDATE club_memberships cm
SET cumulative_tokens_awarded = pkg.initial_token_allocation
FROM club_membership_packages pkg
WHERE cm.package_id = pkg.id
  AND cm.status = 'active'
  AND cm.cumulative_tokens_awarded = 0; -- Only update if not already set

-- ============================================================
-- PART 3: Create Verification Query (for logging/monitoring)
-- ============================================================

-- Log verification results for monitoring
DO $$
DECLARE
  v_total_active_memberships INTEGER;
  v_total_tier_history_records INTEGER;
  v_memberships_without_history INTEGER;
BEGIN
  -- Count active memberships
  SELECT COUNT(*) INTO v_total_active_memberships
  FROM club_memberships
  WHERE status = 'active';

  -- Count tier history records
  SELECT COUNT(*) INTO v_total_tier_history_records
  FROM club_membership_tier_history;

  -- Count memberships without tier history (should be 0 after backfill)
  SELECT COUNT(*) INTO v_memberships_without_history
  FROM club_memberships cm
  WHERE cm.status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM club_membership_tier_history th
      WHERE th.user_id = cm.user_id
      AND th.tier_level = cm.tier_level
    );

  -- Log results (visible in Supabase logs)
  RAISE NOTICE 'Tier History Backfill Complete:';
  RAISE NOTICE '  Active Memberships: %', v_total_active_memberships;
  RAISE NOTICE '  Tier History Records: %', v_total_tier_history_records;
  RAISE NOTICE '  Memberships Without History: %', v_memberships_without_history;

  -- Alert if there are still memberships without history
  IF v_memberships_without_history > 0 THEN
    RAISE WARNING 'Found % active memberships without tier history records!', v_memberships_without_history;
  END IF;
END $$;

-- ============================================================
-- VERIFICATION QUERIES (commented for reference)
-- ============================================================

/*
-- Check tier history was created correctly
SELECT
  u.email,
  cm.tier_level,
  pkg.name as tier_name,
  th.tokens_awarded,
  th.awarded_at,
  cm.purchased_at
FROM club_memberships cm
INNER JOIN auth.users u ON u.id = cm.user_id
INNER JOIN club_membership_packages pkg ON pkg.id = cm.package_id
LEFT JOIN club_membership_tier_history th ON th.membership_id = cm.id
WHERE cm.status = 'active'
ORDER BY cm.tier_level, u.email;

-- Find any active memberships missing tier history (should be empty)
SELECT
  u.email,
  cm.tier_level,
  pkg.name as tier_name,
  cm.id as membership_id
FROM club_memberships cm
INNER JOIN auth.users u ON u.id = cm.user_id
INNER JOIN club_membership_packages pkg ON pkg.id = cm.package_id
WHERE cm.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM club_membership_tier_history th
    WHERE th.user_id = cm.user_id
    AND th.tier_level = cm.tier_level
  );
*/
