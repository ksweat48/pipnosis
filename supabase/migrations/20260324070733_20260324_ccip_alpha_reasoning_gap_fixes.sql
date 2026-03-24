/*
  # CCIP-2026-0324: Alpha Reasoning Gap Fixes — Governance Audit Registration

  ## Title
  Alpha Reasoning Quality Governance — 6 Gap Fixes (CCIP-2026-0324B through 0324G)

  ## Summary
  Registers the deployment of six Alpha reasoning quality fixes in the governance
  audit trail. All fixes live in coordinator-alpha.ts (post-LLM validation layer).
  No destructive changes. No table modifications.

  ## Fixes Registered

  1. CCIP-2026-0324B — wait_pullback zone direction backstop (HIGH)
  2. CCIP-2026-0324C — liquidity_sweep_read omission detector (MEDIUM)
  3. CCIP-2026-0324D — Q8D vs action conflict coherence (MEDIUM)
  4. CCIP-2026-0324E — Q5 failure_probability / confidence consistency (MEDIUM)
  5. CCIP-2026-0324F — Swing data unavailable fallback note (LOW)
  6. CCIP-2026-0324G — trader_statement word count enforcement (LOW)

  ## Security
  No new tables. No RLS changes. Uses existing governance_change_log (already secured).
*/

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'governance_change_log'
    AND table_schema = 'public'
  ) THEN
    INSERT INTO governance_change_log (
      entity_type,
      entity_id,
      operation,
      old_value,
      new_value,
      reason,
      requester_id,
      metadata
    ) VALUES (
      'alpha_coordinator',
      gen_random_uuid(),
      'ccip_migration_applied',
      NULL,
      jsonb_build_object('ccip_version', 'CCIP-2026-0324', 'fix_count', 6),
      'Alpha reasoning quality simulation identified 6 prompt/post-LLM validation gaps. All fixed in coordinator-alpha.ts.',
      NULL,
      jsonb_build_object(
        'ccip_ids', ARRAY['CCIP-2026-0324B', 'CCIP-2026-0324C', 'CCIP-2026-0324D', 'CCIP-2026-0324E', 'CCIP-2026-0324F', 'CCIP-2026-0324G'],
        'violation_types_added', ARRAY[
          'WAIT_PULLBACK_ZONE_DIRECTION_INVERTED',
          'LIQUIDITY_SWEEP_READ_OMITTED',
          'Q8D_WEEKLY_NARRATIVE_CONFLICT_UNRESOLVED',
          'Q5_CONFIDENCE_GAP_NARROW_NO_COHERENCE',
          'TRADER_STATEMENT_ABSENT_OR_TOO_SHORT'
        ],
        'gap_fixes', jsonb_build_object(
          'gap_7_severity', 'HIGH',
          'gap_7', 'wait_pullback zone direction backstop — prevents silent limit order on wrong side',
          'gap_2_severity', 'MEDIUM',
          'gap_2', 'liquidity_sweep_read omission — key sweep signal lost silently',
          'gap_5_severity', 'MEDIUM',
          'gap_5', 'Q8D vs action conflict — weekly narrative unresolved in coherence checklist',
          'gap_3_severity', 'MEDIUM',
          'gap_3', 'Q5 failure_probability consistency — confidence inflation risk',
          'gap_4_severity', 'LOW',
          'gap_4', 'swing data fallback — prevents silent location blindness on data gap',
          'gap_6_severity', 'LOW',
          'gap_6', 'trader_statement word count — audit trail degradation under token pressure'
        ),
        'source_file', 'src/brains/coordinator-alpha.ts',
        'deployed_at', now()
      )
    );
  END IF;

  RAISE NOTICE 'CCIP-2026-0324: 6 Alpha reasoning gap fixes registered in governance audit trail.';
END $$;
