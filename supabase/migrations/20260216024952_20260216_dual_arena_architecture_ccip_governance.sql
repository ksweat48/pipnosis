/*
  # Dual-Arena Architecture v3.0 - CCIP Governance Tracking

  1. Modified Tables
    - `alpha_decisions`
      - `dual_arena_mode` (boolean, default true) - Whether decision used dual-arena walls
      - `arena_chosen` (text) - Which arena Alpha chose: 'LONG', 'SHORT', or 'NO_TRADE'
      - `wall_violations` (jsonb) - Any wall violations detected post-decision

  2. Governance Audit
    - Records architectural change from single-direction to dual-arena in governance_change_log
    - Uses 'ccip_migration_applied' operation and 'system_configuration' entity_type

  3. Important Notes
    - This migration tracks the v3.0 architectural change where Alpha receives both
      long AND short arena walls simultaneously and chooses direction on its own authority
    - Replaces the previous single-direction derivePreliminaryDirection flow
    - All post-LLM confidence manipulations have been removed
    - Omega-9 now enforces catastrophic-only (RED zone) validation
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'dual_arena_mode'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN dual_arena_mode boolean DEFAULT true;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'arena_chosen'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN arena_chosen text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'wall_violations'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN wall_violations jsonb;
  END IF;
END $$;

INSERT INTO governance_change_log (
  id,
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason,
  metadata,
  created_at
) VALUES (
  gen_random_uuid(),
  'system_configuration',
  gen_random_uuid(),
  'ccip_migration_applied',
  jsonb_build_object(
    'architecture', 'single_direction_v2',
    'direction_selection', 'derivePreliminaryDirection deterministic scoring',
    'confidence_manipulations', jsonb_build_array(
      'omega10_minus_5pct',
      'omega8_minus_15pct_plus_10pct',
      'omega9_sl_tp_corrections',
      'omega9_confidence_adjustments',
      'narrative_69pct_cap',
      'post_llm_calibration'
    ),
    'revision_loop', 'alphaRevisionHandler with re-prompting',
    'geometry_handling', 'auto_correct_swap_labels',
    'tp1_handling', 'correct_to_60pct_of_tp2'
  ),
  jsonb_build_object(
    'architecture', 'dual_arena_v3',
    'direction_selection', 'Alpha sees both IF_LONG and IF_SHORT walls, chooses autonomously',
    'confidence_manipulations', 'NONE - Alpha confidence is final',
    'revision_loop', 'REMOVED - replaced with binary wall check',
    'geometry_handling', 'block_dont_correct',
    'tp1_handling', 'discard_if_invalid',
    'omega9_scope', 'catastrophic_only_red_zone',
    'wall_enforcement', 'binary_pass_or_block'
  ),
  'CCIP: Dual-Arena Architecture v3.0 - Alpha has full authority within walls. No post-LLM manipulation.',
  jsonb_build_object(
    'ccip_version', '3.0',
    'files_modified', jsonb_build_array(
      'coordinator-alpha.ts',
      'omega9-hallucination-brain.ts',
      'omega9-constraint-provider.ts',
      'omega9-constraints.ts'
    ),
    'removals', jsonb_build_array(
      'derivePreliminaryDirection',
      'alphaRevisionHandler loop',
      'omega10 confidence penalty',
      'omega8 confidence manipulation',
      'omega9 SL/TP corrections',
      'omega9 confidence adjustments',
      'narrative 69% cap',
      'post-LLM calibration',
      'geometry auto-correction',
      'TP1 60% correction'
    ),
    'additions', jsonb_build_array(
      'DualArenaWalls type system',
      'generateDualArenaWalls()',
      'formatDualArenaForPrompt()',
      'binary wall enforcement check',
      'alpha_decisions.dual_arena_mode column',
      'alpha_decisions.arena_chosen column',
      'alpha_decisions.wall_violations column'
    )
  ),
  now()
);
