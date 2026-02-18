/*
  # CCIP Wall Boundary Floating-Point Tolerance Fix

  ## Summary
  Fixes false wall violation blocks caused by floating-point precision mismatch
  between unrounded pip distance calculations and rounded wall boundary values.

  ## Root Cause
  - calculatePipDistance() returns raw, unrounded floats (e.g., 9.99999999...)
  - Wall bounds from computePipBounds() are rounded to 1 decimal place (e.g., 10.0)
  - Strict less-than comparison treated values AT the boundary as violations

  ## Impact
  Production scan (2026-02-18 ~04:24 UTC, Asian session) produced 3 false wall violations:
  - XAUUSD: TP 14.8 blocked at wall min 14.8 (raw ~14.7999...)
  - GBPUSD: SL 10.0 blocked at wall min 10.0 (raw ~9.9999...)
  - USDJPY: SL 10.0 blocked at wall min 10.0 (raw ~9.9999...)
  Triggered governance alert "Error rate 33.3% exceeds 30%" (3/9 false blocks).

  ## Fix Applied in Frontend Code
  WALL_COMPARISON_EPSILON = 0.05 pips added to all boundary comparisons in:
  1. coordinator-alpha.ts: hard wall block (SL min/max, TP min/max)
  2. style-execution-envelopes.ts: validateTPSLAgainstEnvelope() advisory validation
  Applied to ALL styles: SCALP, MICRO_INTRADAY, INTRADAY, SWING.

  ## SSOT Compliance
  - No changes to wall boundary definitions (SSOT: style-execution-envelopes.ts)
  - No changes to pip calculation logic (SSOT: currencyHelpers.ts)
  - Governance error rate tracking unchanged

  ## Database Changes
  1. Add 'alpha_wall_validation' to valid entity types in governance_change_log
  2. Insert audit record of this CCIP fix using 'ccip_migration_applied' operation
*/

-- 1. Extend valid entity types to include alpha wall validation
ALTER TABLE governance_change_log
  DROP CONSTRAINT IF EXISTS valid_entity_type;

ALTER TABLE governance_change_log
  ADD CONSTRAINT valid_entity_type CHECK (
    entity_type = ANY (ARRAY[
      'goal_sessions',
      'goal_session_trades',
      'entry_intents',
      'user_profiles',
      'pending_user_modals',
      'trade_processing_lock',
      'database_migration',
      'system_configuration',
      'club_token_balances',
      'ai_trader_score',
      'timeout_governance_config',
      'alpha_coordinator',
      'realtime_intelligence_calculator',
      'alpha_wall_validation'
    ])
  );

-- 2. Record the fix in the governance audit trail
INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  reason,
  metadata
)
VALUES (
  'alpha_wall_validation',
  gen_random_uuid(),
  'ccip_migration_applied',
  'CCIP 20260218: Added WALL_COMPARISON_EPSILON=0.05 pips to all wall boundary comparisons. Fixes false violations where imperceptibly small float differences (e.g., 9.9999... vs 10.0) incorrectly blocked valid trades. Applies to ALL styles: SCALP, MICRO_INTRADAY, INTRADAY, SWING.',
  jsonb_build_object(
    'ccip_id', '20260218_wall_boundary_fp_tolerance',
    'files_modified', jsonb_build_array(
      'src/brains/coordinator-alpha.ts',
      'src/config/style-execution-envelopes.ts'
    ),
    'epsilon_pips', 0.05,
    'affected_styles', jsonb_build_array('SCALP', 'MICRO_INTRADAY', 'INTRADAY', 'SWING'),
    'root_cause', 'floating_point_precision_mismatch_between_raw_pip_distance_and_rounded_wall_bounds',
    'evidence', jsonb_build_array(
      'XAUUSD TP 14.8 blocked at wall min 14.8',
      'GBPUSD SL 10.0 blocked at wall min 10.0',
      'USDJPY SL 10.0 blocked at wall min 10.0'
    ),
    'false_blocks_count', 3,
    'governance_alert_triggered', true,
    'scan_timestamp', '2026-02-18T04:24:00Z'
  )
);
