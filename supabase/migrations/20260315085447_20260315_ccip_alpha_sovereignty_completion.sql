/*
  # CCIP-2026-03-15: Alpha Sovereignty Completion

  ## Summary
  Records the removal of the last two surviving code paths that modified Alpha's
  stated trade_confidence after his LLM output. Alpha is now the sole, unmodified
  authority on confidence from parse through wall check through execution.

  ## Changes Recorded

  ### 1. event-based-llm-engine.ts
  - Removed stale assignment of penaltyResult.finalConfidence to finalDecision.confidence
  - finalDecision is now safetyCheck.adjustedDecision || decision directly
  - Advisory log updated: no longer implies confidence changed

  ### 2. alpha-omega-orchestrator.ts
  - platform_streak_modifier moved from execution path to advisory-only modifier
  - platform_streak_modifier: 0 passed to calculateFinalConfidence (no execution mutation)
  - finalConfidence returned to caller = originalConfidence (Alpha's raw value)
  - confidenceCalculationAudit.finalConfidence shows engine-computed advisory value
    for dashboard monitoring

  ## Governance Impact
  Alpha self-prices all signals via briefing context during LLM reasoning.
  No post-Alpha arithmetic applied to execution confidence.
  Full advisory audit trail preserved for dashboards and analytics.

  ## Security
  No RLS changes. No destructive operations. Metadata record only.
*/

INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason,
  metadata
)
VALUES (
  'alpha_execution_policy',
  gen_random_uuid(),
  'configuration_change',
  '{"confidence_path": "originalConfidence + platformStreakModifier additive in orchestrator. event_engine: penaltyResult.finalConfidence assigned to finalDecision.confidence"}',
  '{"confidence_path": "originalConfidence passed through unchanged. event_engine: safetyCheck.adjustedDecision || decision used directly. platform_streak: advisory confidenceModifiers only"}',
  'CCIP-2026-03-15: Alpha Sovereignty Completion — all post-Alpha confidence mutations removed. Alpha raw confidence is the execution value end-to-end.',
  '{"ccip_id": "CCIP-2026-03-15-ALPHA-SOVEREIGNTY", "affected_files": ["src/services/alpha-omega-orchestrator.ts", "src/services/event-based-llm-engine.ts"], "breaking_improvement": true, "advisory_trail_preserved": true}'
);
