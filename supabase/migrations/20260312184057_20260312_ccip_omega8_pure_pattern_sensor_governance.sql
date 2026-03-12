/*
  # CCIP-2026-03-12: Omega-8 Pure Pattern Sensor Refactor

  ## Summary
  Omega-8 was violating the core architectural principle that Alpha is the sole
  decision-maker. It was running a deterministic scoring engine (point-based bias
  calculation) plus an internal LLM call (gpt-4o-mini), then passing pre-scored
  directional bias labels to Alpha. This is Alpha's job, not Omega-8's.

  ## What Changed

  ### Removed from Omega-8
  - Deterministic scoring algorithm (bias: BUY/SELL/NEUTRAL + confidence: 0-100%)
  - Internal LLM refinement call (gpt-4o-mini)
  - direction_support field from Omega8Vote type
  - omega8_direction_support from AlphaDecision and journal entry

  ### What Omega-8 Now Provides (raw computed facts only)
  - Sweep extreme prices (exact wick-level math)
  - Equal highs/lows cluster detection with counts
  - Fair Value Gap locations and counts
  - Sweep recency + BOS confirmation
  - Liquidity structural classification (factual: what happened, not directional)

  ## Governance Compliance
  - SSOT: Omega8Vote type is canonical SSOT for pattern data contract
  - Architecture: Alpha remains sole decision-maker
  - No business logic changed — same pattern detection algorithms, different output contract

  ## Database Notes
  The ai_trade_journal columns omega8_direction_support, omega8_confidence,
  omega8_used_llm, omega8_deterministic_bias, omega8_deterministic_confidence,
  omega8_llm_reason are now orphaned (no code writes to them).
  They are preserved for historical audit trail and are NOT dropped.
*/

INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason,
  metadata
) VALUES (
  'alpha_coordinator',
  gen_random_uuid(),
  'ccip_migration_applied',
  '{"omega8_role": "scoring_engine_with_llm", "outputs": ["direction_support", "confidence", "bias"]}',
  '{"omega8_role": "pure_pattern_sensor", "outputs": ["patterns", "signals", "liquidity_bias", "sweep_details"]}',
  'CCIP-2026-03-12: Omega-8 converted from scoring engine + LLM to pure pattern sensor. Alpha is now sole decision-maker. direction_support field removed.',
  '{"ccip": "CCIP-2026-03-12", "files_changed": 9, "breaking_change": false, "rollback_safe": true}'
);
