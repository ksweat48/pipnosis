/*
  # CCIP Position Size Governance - Enforce NOT NULL on position_size

  ## Purpose
  The canonical lot-size column is position_size (written exclusively by position-service.ts).
  The lot_size column is a legacy alias. This migration enforces position_size as NOT NULL
  so all future code paths are forced through the SSOT writer.

  ## Pre-condition Verification
  Audited 2026-02-18: Zero rows have NULL or 0 position_size. Safe to add constraint.

  ## Changes Made

  ### 1. Backfill position_size from lot_size where position_size is 0 (defensive)
  Covers any edge case where a zero was stored instead of NULL.

  ### 2. NOT NULL constraint on goal_session_trades.position_size
  Prevents future NULL insertions. Any INSERT without position_size will fail at DB layer.

  ### Security / RLS
  No RLS changes - schema governance only.
*/

-- Step 1: Defensive backfill from lot_size where position_size is 0
-- (audit shows 0 such rows, this is a safety net)
UPDATE goal_session_trades
SET position_size = lot_size
WHERE (position_size IS NULL OR position_size = 0)
  AND lot_size IS NOT NULL
  AND lot_size > 0;

-- Step 2: Enforce NOT NULL (idempotent - will succeed even if column is already NOT NULL)
DO $$
BEGIN
  -- Check current nullability
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'goal_session_trades'
      AND column_name = 'position_size'
      AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE goal_session_trades
      ALTER COLUMN position_size SET NOT NULL;
  END IF;
END $$;
