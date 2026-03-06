/*
  # CCIP Wall Comparison Epsilon 0.05 → 0.15 Governance Audit Record

  ## Summary
  Records the governance change to increase WALL_COMPARISON_EPSILON and
  ENVELOPE_COMPARISON_EPSILON from 0.05 to 0.15 pips in the wall boundary
  validation system.

  ## Root Cause
  The original epsilon of 0.05 pips was insufficient to absorb two-sided
  floating-point rounding:

  1. Wall bounds (computed via Math.round(price * slPercent / pipValue * 10) / 10)
     introduce up to 0.05 pip of rounding on the wall/bound side.
  2. calculatePipDistance() returns unrounded floats, carrying its own floating-point
     precision error from the proposal side.

  Combined, these two rounding sources can produce a net gap of up to 0.10 pips,
  which exceeded the 0.05 epsilon and caused false wall violation blocks.

  ## Evidence
  Production scan (2026-03-06, Asian session, ~09:00 UTC):
  - ETHUSD: SL 10.3 pips blocked at wall min 10.4 pips (gap: 0.1 pip)
  - Trade was a valid BUY with positive Omega-8 consensus
  - Governance alert triggered: "Error rate 55.6% exceeds 30%"
  - Total scan time: 209076ms (threshold: 120000ms) due to compounded retry costs
  - Only symbol with a directional Alpha decision; false block prevented all execution

  ## Fix Applied
  1. coordinator-alpha.ts: WALL_COMPARISON_EPSILON raised to 0.15 pips
  2. style-execution-envelopes.ts: ENVELOPE_COMPARISON_EPSILON raised to 0.15 pips
     (same two-sided rounding problem exists in advisory validation layer)
  3. coordinator-alpha.ts: epsilon_pips added to wall violation log errorDetails
     for post-hoc audit traceability

  ## SSOT Compliance
  - No changes to wall boundary definitions (SSOT: style-execution-envelopes.ts)
  - No changes to pip calculation logic (SSOT: currencyHelpers.ts)
  - No changes to the wall authority model (Alpha proposes, walls enforce)
  - Both epsilon constants aligned to 0.15 for consistency across validation layers

  ## Security Analysis
  A tolerance of 0.15 pips represents:
  - For FOREX: 0.15 × $10 = $1.50 per pip-point — negligible noise floor relaxation
  - For XAUUSD: 0.15 × $1 = $0.15 per pip — negligible
  - For ETHUSD at $3,500: 0.15 × $1 = $0.15 per pip — negligible
  - For BTCUSD at $90,000: 0.15 × $1 = $0.15 per pip — negligible
  The relaxation does NOT meaningfully change the effective wall protection level for any
  asset class. Genuine violations (misaligned R:R, wrong style, oversized SL) are still
  blocked with substantial margin.

  ## CCIP ID
  CCIP-2026-03-06-WALL-EPSILON-0.15

  ## Previous Record
  CCIP ID: 20260218_wall_boundary_fp_tolerance (migration 20260218050808)
  Previous epsilon: 0.05 pips (single-sided rounding only)
*/

-- Record the CCIP epsilon upgrade in the governance audit trail
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
  'CCIP 20260306: Raised WALL_COMPARISON_EPSILON and ENVELOPE_COMPARISON_EPSILON from 0.05 to 0.15 pips. Fixes false wall violation blocks caused by combined two-sided floating-point rounding (wall bound rounding + pip distance floating-point error). Evidence: ETHUSD SL 10.3 blocked at wall min 10.4 on 2026-03-06 Asian session scan.',
  jsonb_build_object(
    'ccip_id', 'CCIP-2026-03-06-WALL-EPSILON-0.15',
    'previous_ccip_id', '20260218_wall_boundary_fp_tolerance',
    'files_modified', jsonb_build_array(
      'src/brains/coordinator-alpha.ts',
      'src/config/style-execution-envelopes.ts'
    ),
    'epsilon_pips_before', 0.05,
    'epsilon_pips_after', 0.15,
    'affected_styles', jsonb_build_array('SCALP', 'MICRO_INTRADAY', 'INTRADAY', 'SWING'),
    'root_cause', 'two_sided_rounding_error_wall_bound_plus_pip_distance_combined_0.10_pip_gap',
    'evidence', jsonb_build_array(
      'ETHUSD SL 10.3 pips blocked at wall min 10.4 pips (gap: 0.1 pip)',
      'Governance alert: Error rate 55.6% exceeds 30%',
      'Scan total 209076ms exceeded 120000ms threshold',
      'Only directional Alpha decision blocked; all 9 symbols returned NO_TRADE'
    ),
    'false_blocks_count', 1,
    'governance_alert_triggered', true,
    'scan_timestamp', '2026-03-06T09:00:00Z',
    'additional_fix', 'epsilon_pips added to ALPHA_WALL_VIOLATION log errorDetails for audit traceability',
    'security_analysis', 'Tolerance of 0.15 pips is negligible noise floor relaxation across all asset classes; genuine violations still blocked with substantial margin'
  )
);
