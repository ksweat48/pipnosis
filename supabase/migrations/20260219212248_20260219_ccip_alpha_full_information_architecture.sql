/*
  # CCIP Governance Audit — Alpha Full Information Architecture
  ## Change Reference: CCIP-2026-0219C

  ### Summary
  Governance audit record for Alpha Full Information Architecture changes.

  ### Changes Enacted (Code Level)
  1. EQS penalties removed — rewards only in EQS_CONFIDENCE_MODIFIERS (alpha-identity.ts)
  2. New hard gate block conditions added: MTF_DATA_MISSING, PRIMARY_TF_DATA_MISSING, EQS_INPUTS_MISSING
  3. HTF controlling timeframe candles added to coordinator-alpha.ts:
     - MICRO_INTRADAY: H1 candles (10) — hard gate if unavailable
     - INTRADAY: H4 candles (8) — hard gate if unavailable
  4. Alpha system prompt enhanced:
     - MTF conflict = information for Alpha to reason (not a block or penalty)
     - Smaller TF confirmation: M15 close for INTRADAY EXECUTE_NOW, M5 for MICRO_INTRADAY
     - TREND + STRUCTURE anchor weighting for confluence
     - MTF CONFLICT SIGNALS section added to Market Context
  5. Advisory penalties made fully informational (advisory-penalty-aggregator.ts):
     - finalConfidence = originalConfidence (no deduction)
     - Penalties logged for audit monitoring only

  ### Governance Principle
  Alpha needs all tools and the full picture. Missing data = NO_TRADE.
  Conflicting data = Information for Alpha to reason. Advisory signals = Context only.
*/

INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason,
  requester_id,
  metadata
)
VALUES (
  'alpha_coordinator',
  gen_random_uuid(),
  'ccip_migration_applied',
  jsonb_build_object(
    'ccip_reference', 'CCIP-2026-0219C',
    'eqs_penalties', 'active (-2 to -30 range)',
    'htf_candles_micro', 'absent',
    'htf_candles_intraday', 'absent',
    'advisory_penalties_applied', true,
    'block_conditions_count', 6,
    'mtf_conflict_handling', 'penalty-based'
  ),
  jsonb_build_object(
    'ccip_reference', 'CCIP-2026-0219C',
    'eqs_penalties', 'removed — rewards only 0 to +5',
    'htf_candles_micro', 'H1 10 candles — hard gate on missing',
    'htf_candles_intraday', 'H4 8 candles — hard gate on missing',
    'advisory_penalties_applied', false,
    'block_conditions_count', 9,
    'mtf_conflict_handling', 'information for Alpha reasoning'
  ),
  'CCIP-2026-0219C: Alpha Full Information Architecture — remove all code-level penalties, add HTF structural data, make advisory signals fully informational.',
  NULL,
  jsonb_build_object(
    'files_changed', ARRAY['alpha-identity.ts', 'coordinator-alpha.ts', 'advisory-penalty-aggregator.ts'],
    'styles_affected', ARRAY['MICRO_INTRADAY', 'INTRADAY'],
    'breaking_changes', false,
    'governance_directive', 'Give Alpha all tools and the full picture to make the best trading decision'
  )
);
