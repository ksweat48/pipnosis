/*
  # Create Cumulative Tier Token Tracking System

  ## Summary
  Implements the foundation for cumulative tier token bonuses. Users who purchase higher tiers
  receive token bonuses from ALL tiers they pass through, not just their purchased tier.

  ## Changes
  1. Create `club_membership_tier_history` table (SSOT for awarded tier bonuses)
  2. Add upgrade tracking columns to `club_memberships` table
  3. Add RLS policies for security
  4. Create indexes for performance

  ## Business Logic
  - When a user buys Founder directly, they get bonuses from Member, Starter, Builder, Pro, Elite, and Founder
  - When upgrading from Member to Builder, they get bonuses from Starter and Builder (not Member again)
  - Tier history ensures no double-awarding of bonuses

  ## SSOT Compliance
  - `club_membership_tier_history` is canonical source for "which tier bonuses has this user received"
  - Unique constraint prevents duplicate tier awards
  - Immutable history (no updates, only inserts)

  ## CCIP Reference
  See: CUMULATIVE_TIER_TOKENS_CCIP_20260210.md
*/

-- ============================================================
-- PART 1: Create Tier History Table (SSOT)
-- ============================================================

CREATE TABLE IF NOT EXISTS club_membership_tier_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tier_level INTEGER NOT NULL CHECK (tier_level >= 1 AND tier_level <= 10),
  tier_name TEXT NOT NULL,
  tokens_awarded NUMERIC(12,2) NOT NULL CHECK (tokens_awarded >= 0),
  membership_id UUID NOT NULL REFERENCES club_memberships(id) ON DELETE CASCADE,
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- SSOT Constraint: Each user can only receive each tier bonus once
  CONSTRAINT unique_user_tier_award UNIQUE (user_id, tier_level)
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_tier_history_user_id ON club_membership_tier_history(user_id);
CREATE INDEX IF NOT EXISTS idx_tier_history_membership_id ON club_membership_tier_history(membership_id);
CREATE INDEX IF NOT EXISTS idx_tier_history_tier_level ON club_membership_tier_history(tier_level);
CREATE INDEX IF NOT EXISTS idx_tier_history_awarded_at ON club_membership_tier_history(awarded_at);

-- ============================================================
-- PART 2: Add Upgrade Tracking to Memberships Table
-- ============================================================

DO $$
BEGIN
  -- Track if this membership is an upgrade vs new purchase
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'club_memberships' AND column_name = 'is_upgrade'
  ) THEN
    ALTER TABLE club_memberships ADD COLUMN is_upgrade BOOLEAN DEFAULT false NOT NULL;
  END IF;

  -- Link to previous membership if upgrading
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'club_memberships' AND column_name = 'previous_membership_id'
  ) THEN
    ALTER TABLE club_memberships ADD COLUMN previous_membership_id UUID REFERENCES club_memberships(id);
  END IF;

  -- Track how many tokens were awarded as upgrade bonus
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'club_memberships' AND column_name = 'cumulative_tokens_awarded'
  ) THEN
    ALTER TABLE club_memberships ADD COLUMN cumulative_tokens_awarded NUMERIC(12,2) DEFAULT 0 NOT NULL;
  END IF;

  -- Track previous tier level for audit trail
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'club_memberships' AND column_name = 'previous_tier_level'
  ) THEN
    ALTER TABLE club_memberships ADD COLUMN previous_tier_level INTEGER;
  END IF;
END $$;

-- Add index on previous_membership_id for upgrade chain queries
CREATE INDEX IF NOT EXISTS idx_memberships_previous_id ON club_memberships(previous_membership_id);
CREATE INDEX IF NOT EXISTS idx_memberships_is_upgrade ON club_memberships(is_upgrade);

-- ============================================================
-- PART 3: RLS Policies for Tier History
-- ============================================================

ALTER TABLE club_membership_tier_history ENABLE ROW LEVEL SECURITY;

-- Users can view their own tier history
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'club_membership_tier_history'
    AND policyname = 'Users can view own tier history'
  ) THEN
    CREATE POLICY "Users can view own tier history"
      ON club_membership_tier_history
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- Service role has full access for token allocation
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'club_membership_tier_history'
    AND policyname = 'Service role full access to tier history'
  ) THEN
    CREATE POLICY "Service role full access to tier history"
      ON club_membership_tier_history
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Admin users can view all tier history
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'club_membership_tier_history'
    AND policyname = 'Admins can view all tier history'
  ) THEN
    CREATE POLICY "Admins can view all tier history"
      ON club_membership_tier_history
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM user_profiles
          WHERE user_profiles.id = auth.uid()
          AND user_profiles.is_admin = true
        )
      );
  END IF;
END $$;

-- ============================================================
-- PART 4: Create Helper View for Tier Progress
-- ============================================================

CREATE OR REPLACE VIEW club_user_tier_progression AS
SELECT
  u.id as user_id,
  u.email,
  cm.tier_level as current_tier_level,
  pkg.name as current_tier_name,
  cm.cumulative_tokens_awarded,
  COUNT(th.tier_level) as tiers_awarded_count,
  ARRAY_AGG(th.tier_level ORDER BY th.tier_level) FILTER (WHERE th.tier_level IS NOT NULL) as tiers_awarded,
  COALESCE(SUM(th.tokens_awarded), 0) as total_tier_bonuses,
  MAX(th.awarded_at) as last_tier_award_at
FROM auth.users u
LEFT JOIN club_memberships cm ON cm.user_id = u.id AND cm.status = 'active'
LEFT JOIN club_membership_packages pkg ON pkg.id = cm.package_id
LEFT JOIN club_membership_tier_history th ON th.user_id = u.id
GROUP BY u.id, u.email, cm.tier_level, pkg.name, cm.cumulative_tokens_awarded;

COMMENT ON VIEW club_user_tier_progression IS
'Aggregated view of user tier progression and cumulative bonuses received. Used for admin dashboards and analytics.';
