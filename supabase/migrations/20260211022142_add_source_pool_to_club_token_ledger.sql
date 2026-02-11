/*
  # Add Source Pool Tracking to Club Token Ledger

  ## Summary
  Bridges the gap between the club_token_ledger (active user transaction log)
  and the token_pools system (supply accounting). Without this, tokens appear
  to come from nowhere and pool balances are inaccurate.

  ## Changes
  1. New Columns on `club_token_ledger`
    - `source_pool_id` (TEXT) - Which pool the tokens came from/went to
    - `initiated_by_admin_id` (UUID) - Admin who authorized manual grants
  2. Backfill existing records
    - membership_purchase (10,000 PIP) -> COMMUNITY_INCENTIVES
    - admin_grant (6,850 PIP total) -> COMMUNITY_INCENTIVES
    - membership_lock -> NULL (internal movement, no pool involved)
  3. Index on source_pool_id for pool-level analytics

  ## SSOT Compliance
  - club_token_ledger becomes the SSOT link between user balances and pool accounting
  - Every future token grant MUST specify a source pool
  - Backfill ensures historical accuracy
*/

-- Add source_pool_id column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'club_token_ledger' AND column_name = 'source_pool_id'
  ) THEN
    ALTER TABLE club_token_ledger ADD COLUMN source_pool_id TEXT
      REFERENCES token_pools(pool_id);
  END IF;
END $$;

-- Add initiated_by_admin_id column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'club_token_ledger' AND column_name = 'initiated_by_admin_id'
  ) THEN
    ALTER TABLE club_token_ledger ADD COLUMN initiated_by_admin_id UUID
      REFERENCES auth.users(id);
  END IF;
END $$;

-- Index for pool-level analytics
CREATE INDEX IF NOT EXISTS idx_club_token_ledger_source_pool
  ON club_token_ledger(source_pool_id)
  WHERE source_pool_id IS NOT NULL;

-- Backfill existing records: membership_purchase -> COMMUNITY_INCENTIVES
UPDATE club_token_ledger
SET source_pool_id = 'COMMUNITY_INCENTIVES'
WHERE transaction_type = 'membership_purchase'
  AND source_pool_id IS NULL;

-- Backfill existing records: admin_grant (tier bonuses) -> COMMUNITY_INCENTIVES
UPDATE club_token_ledger
SET source_pool_id = 'COMMUNITY_INCENTIVES'
WHERE transaction_type = 'admin_grant'
  AND source_pool_id IS NULL;

-- membership_lock is an internal movement (no pool involved), leave NULL
