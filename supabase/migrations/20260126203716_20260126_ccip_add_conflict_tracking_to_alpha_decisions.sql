/*
  # CCIP: Add Conflict Tracking to Alpha Decisions

  ## Change Summary
  Add missing columns to alpha_decisions table to support Alpha Learning Tracker's conflict detection and learning system.

  ## Changes
  1. New Columns
    - `conflict_detected` (boolean, default false): Tracks when Alpha detects a conflict with Omega consensus
    - `conflict_type` (text): Categorizes conflict severity ('HARD', 'SOFT', 'NONE')
    - `override_reason` (text): Documents why Alpha overrode Omega consensus

  ## CCIP Compliance
  - Change Type: Schema Extension (Non-Breaking)
  - Impact: Adds missing columns required by alpha-learning-tracker.ts
  - Compatibility: Backward compatible - existing inserts work, new code can use new fields
  - Root Cause: alpha-learning-tracker.ts expects these columns but they were never created

  ## Safety Measures
  - All new columns are nullable or have defaults
  - No data loss risk
  - No existing code breakage
*/

-- Add conflict tracking columns to alpha_decisions
DO $$ 
BEGIN
  -- Add conflict_detected column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'alpha_decisions' AND column_name = 'conflict_detected'
  ) THEN
    ALTER TABLE alpha_decisions 
    ADD COLUMN conflict_detected boolean DEFAULT false NOT NULL;
    RAISE NOTICE '✅ Added conflict_detected column';
  END IF;

  -- Add conflict_type column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'alpha_decisions' AND column_name = 'conflict_type'
  ) THEN
    ALTER TABLE alpha_decisions 
    ADD COLUMN conflict_type text DEFAULT 'NONE';
    
    -- Add constraint for valid conflict types
    ALTER TABLE alpha_decisions 
    ADD CONSTRAINT alpha_decisions_conflict_type_check 
    CHECK (conflict_type IN ('HARD', 'SOFT', 'NONE'));
    RAISE NOTICE '✅ Added conflict_type column with constraints';
  END IF;

  -- Add override_reason column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'alpha_decisions' AND column_name = 'override_reason'
  ) THEN
    ALTER TABLE alpha_decisions 
    ADD COLUMN override_reason text;
    RAISE NOTICE '✅ Added override_reason column';
  END IF;
END $$;

-- Create index for conflict analysis queries
CREATE INDEX IF NOT EXISTS idx_alpha_decisions_conflict_tracking 
ON alpha_decisions(conflict_detected, conflict_type) 
WHERE conflict_detected = true;

-- Verification query
DO $$
DECLARE
  conflict_detected_exists boolean;
  conflict_type_exists boolean;
  override_reason_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'alpha_decisions' AND column_name = 'conflict_detected'
  ) INTO conflict_detected_exists;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'alpha_decisions' AND column_name = 'conflict_type'
  ) INTO conflict_type_exists;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'alpha_decisions' AND column_name = 'override_reason'
  ) INTO override_reason_exists;

  IF NOT conflict_detected_exists OR NOT conflict_type_exists OR NOT override_reason_exists THEN
    RAISE EXCEPTION 'Migration verification failed: Required columns not created';
  END IF;

  RAISE NOTICE '🎯 CCIP Migration Complete: All conflict tracking columns verified';
END $$;
