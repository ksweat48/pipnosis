/*
  # Alpha Authority Restoration — Remove Pre-LLM Conflict Gates

  ## Summary
  CCIP-2026-03-03: Removes the pre-LLM HTF and M15 conflict blocking gates
  from coordinator-alpha.ts and records the architectural change in the
  governance audit trail.

  ## What Changed (Code)
  - HTF conflict gate (H1/H4 candle trend vs Omega-8 direction_support) was
    blocking the Alpha LLM call before Alpha could speak. This violated Alpha's
    final authority charter (coordinator-alpha.ts header, lines 36-39).
  - M15 conflict gate for SCALP style had the same violation.
  - Both gates used Omega-8's direction_support (a pattern interpretation output)
    as a proxy for Alpha's intended direction — but Alpha had not yet been consulted.
  - Fix: BOS and sweep-wick facts are still computed, now embedded as pre-labeled
    context in the Alpha LLM prompt. Alpha reads the evidence and decides.

  ## Schema Changes

  ### 1. structural_alerts.rule_type constraint
  - H1_CONFLICT_BLOCKED, H4_CONFLICT_BLOCKED, M15_CONFLICT_BLOCKED normalised
    to HTF_CONFLICT_BLOCKED (legacy catch-all) and removed from constraint enum.
  - All existing audit rows are preserved. No data is deleted.

  ### 2. governance_change_log entry
  - Records this CCIP change under entity_type = 'alpha_coordinator',
    operation = 'ccip_migration_applied'.

  ## Security
  - No RLS changes. Existing policies remain intact.

  ## Important Notes
  1. HTF_CONFLICT_BLOCKED rule_type retained as legacy historical catch-all.
  2. New code never writes any _CONFLICT_BLOCKED rule types.
  3. pre_screen_results table is unchanged.
*/

-- ─────────────────────────────────────────────────────────────────────
-- Step 1: Normalise historical rows before constraint is tightened
-- ─────────────────────────────────────────────────────────────────────
UPDATE structural_alerts
SET rule_type = 'HTF_CONFLICT_BLOCKED'
WHERE rule_type IN ('H1_CONFLICT_BLOCKED', 'H4_CONFLICT_BLOCKED', 'M15_CONFLICT_BLOCKED');

-- ─────────────────────────────────────────────────────────────────────
-- Step 2: Replace the rule_type check constraint
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT conname INTO v_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'structural_alerts'::regclass
    AND contype = 'c'
    AND conname ILIKE '%rule_type%';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE structural_alerts DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

ALTER TABLE structural_alerts
  ADD CONSTRAINT structural_alerts_rule_type_check
  CHECK (rule_type IN (
    'M15_BOS',
    'M15_SWEEP_WICK',
    'H1_BOS',
    'H1_SWEEP_WICK',
    'H4_BOS',
    'H4_SWEEP_WICK',
    'HTF_DATA_MISSING',
    'HTF_CONFLICT_QUALIFIED',
    'HTF_CONFLICT_BLOCKED'
  ));

-- ─────────────────────────────────────────────────────────────────────
-- Step 3: Record in governance_change_log
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  reason,
  metadata
)
VALUES (
  'alpha_coordinator',
  gen_random_uuid(),
  'ccip_migration_applied',
  'CCIP-2026-03-03: Removed pre-LLM HTF and M15 conflict blocking gates. BOS and sweep-wick evidence is now computed and embedded in Alpha LLM prompt as labeled facts. Alpha is the sole decision authority for counter-trend qualification. Omega-8 direction_support was incorrectly used as a proxy for Alpha intent before Alpha was consulted. Rule types H1_CONFLICT_BLOCKED, H4_CONFLICT_BLOCKED, M15_CONFLICT_BLOCKED retired.',
  jsonb_build_object(
    'ccip_id', 'CCIP-2026-03-03',
    'files_changed', to_jsonb(ARRAY['src/brains/coordinator-alpha.ts']),
    'gates_removed', to_jsonb(ARRAY['HTF_conflict_gate', 'M15_SCALP_conflict_gate']),
    'rule_types_retired', to_jsonb(ARRAY['H1_CONFLICT_BLOCKED', 'H4_CONFLICT_BLOCKED', 'M15_CONFLICT_BLOCKED']),
    'authority_principle', 'Alpha is sole trading decision authority per coordinator-alpha.ts header lines 36-39',
    'ssot_ownership', 'coordinator-alpha.ts computes structural facts; Alpha LLM owns trade decisions',
    'change_date', to_jsonb(now()::text)
  )
);
