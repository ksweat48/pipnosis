/*
  # CCIP Governance Change: Dead Zone — Pure Advisory Model

  ## Summary
  Removes all system-applied arithmetic penalties that modified Alpha's confidence
  rating based on dead zone or session phase. Dead zone is now purely informational:
  Alpha observes the session context, incorporates it into ONE honest confidence rating,
  and if that rating clears the style threshold, it is a trade.

  ## Changes Made

  ### 1. alpha-omega-orchestrator.ts — computeRegimePenaltyFromRaw()
  - REMOVED: Dead zone additive penalty (0.05 fixed + scaled by session_weight)

  ### 2. alpha-omega-orchestrator.ts — calculateSessionAdvisoryPenalty()
  - REMOVED: Dead zone fixed 5% penalty when expectedFillMin <= 0
  - REMOVED: Dead zone minimum penalty floor of 5% in fill-ratio graduated branches

  ### 3. alpha-advanced-patterns.ts — SESSION_PROFILES
  - SCALP.DEAD_ZONE.confidence_adjustment: -10 -> 0
  - MICRO_INTRADAY.NY_LUNCH.confidence_adjustment: -10 -> 0

  ### 4. alpha-identity.ts — Session Rules
  - All dead zone hard enforcement blocks replaced with pure advisory awareness
  - Pre-submission checklist item 1 updated
  - Final RULES line updated: session phase alone does not block any style

  ## CCIP Governance Rationale
  Alpha is the SSOT for confidence. No downstream service may arithmetically modify
  Alpha's stated confidence. Dead zone is information Alpha absorbs, not a system veto.
  This corrects a SSOT violation where the system arithmetically discounted Alpha's
  confidence after it was produced, creating a dual-authority conflict.
*/

INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason,
  metadata,
  created_at
)
VALUES (
  'alpha_prompt_config',
  gen_random_uuid(),
  'configuration_change',
  '{"policy": "dead_zone_system_penalties_active", "penalties": ["regime_penalty_0.05_dead_zone", "session_advisory_penalty_0.05_floor", "SESSION_PROFILES_confidence_adjustment_minus10_SCALP_DEAD_ZONE", "SESSION_PROFILES_confidence_adjustment_minus10_MICRO_INTRADAY_NY_LUNCH", "alpha_identity_HARD_ENFORCEMENT_dead_zone_block_SCALP"]}',
  '{"policy": "dead_zone_pure_advisory", "penalties": "none", "authority": "Alpha sole authority for confidence. Dead zone incorporated into honest rating. No system arithmetic applied post-confidence-production."}',
  'SSOT violation corrected: system was arithmetically modifying Alpha confidence after production. Alpha must produce ONE honest confidence rating incorporating all data including dead zone. If confidence clears style threshold, it is a trade.',
  '{"ccip_version": "2026-03-07", "governance_impact": "HIGH", "files_modified": ["src/services/alpha-omega-orchestrator.ts", "src/config/alpha-advanced-patterns.ts", "src/config/alpha-identity.ts"]}',
  now()
);
