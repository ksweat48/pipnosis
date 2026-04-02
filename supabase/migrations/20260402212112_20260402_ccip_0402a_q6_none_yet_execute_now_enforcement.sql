/*
  # CCIP-2026-0402A: Q6=NONE_YET + execute_now Conflict Enforcement

  ## What This Migration Does

  Ensures the ssot_violations table can accept the new
  'Q6_NONE_YET_EXECUTE_NOW_CONFLICT' violation type from coordinator-alpha.ts.

  ## Background

  Alpha's own framework states:
    "The absence of a fired trigger supports wait_pullback or push_confirmation"

  In the USDJPY trade (2026-04-02, trade 685d0c91), Alpha answered Q6=NONE_YET
  (no trigger fired) but selected entry_mode=execute_now — a self-contradiction.
  Price ran 25 pips against entry from tick 1.

  The coordinator now enforces this consistency rule by downgrading
  execute_now → wait_pullback whenever Q6=NONE_YET is detected post-LLM.
  This migration ensures the violation log insert succeeds.

  ## Changes

  1. Drops any overly-restrictive violation_type check constraint on
     ssot_violations and replaces it with a non-empty string check.
     This future-proofs new violation types without repeated migrations.

  2. Creates a diagnostic view q6_entry_mode_conflicts for rapid querying
     of the new Q6 conflict history.

  ## Security
  - No new tables — existing ssot_violations RLS unchanged.
  - View uses SECURITY INVOKER (default for views).
*/

-- Step 1: Drop any existing violation_type check constraint.
DO $$
DECLARE
  v_constraint text;
BEGIN
  SELECT constraint_name INTO v_constraint
  FROM information_schema.table_constraints
  WHERE table_name = 'ssot_violations'
    AND constraint_type = 'CHECK'
    AND table_schema = 'public'
    AND constraint_name ILIKE '%violation_type%'
  LIMIT 1;

  IF v_constraint IS NOT NULL THEN
    EXECUTE 'ALTER TABLE ssot_violations DROP CONSTRAINT ' || quote_ident(v_constraint);
  END IF;
END $$;

-- Step 2: Add a simple non-null, non-empty constraint instead of an enum list.
ALTER TABLE ssot_violations
  ADD CONSTRAINT ssot_violations_violation_type_nonempty
  CHECK (violation_type IS NOT NULL AND length(trim(violation_type)) > 0);

-- Step 3: Create diagnostic view for Q6 conflict monitoring.
CREATE OR REPLACE VIEW q6_entry_mode_conflicts AS
SELECT
  id,
  violation_type,
  symbol,
  call_location,
  blocked,
  error_details,
  severity,
  user_id,
  created_at
FROM ssot_violations
WHERE violation_type = 'Q6_NONE_YET_EXECUTE_NOW_CONFLICT'
ORDER BY created_at DESC;
