/*
  # CCIP Governance Audit — Alpha Sovereignty: Pre-Reasoning Layer Removal
  2026-03-20

  ## Summary
  This migration documents and governs the permanent removal of all pre-reasoning
  infrastructure that was intercepting Alpha's decision pipeline. Seven services
  were audited and stripped of pre-interpretation logic.

  ## Changes Made (Frontend Code — audited here for traceability)

  ### 1. confidence-calculation-engine.ts — PENALTY SYSTEM PERMANENTLY REMOVED
  - Removed: 6-domain authority penalty system (RegimeOracle, EQS, Narrative,
    AdversarialDetector, SessionAdvisor, PatternConfidence)
  - Removed: ConfidenceModifier type, DOMAIN_AUTHORITIES, RISK_MODE_FLOORS
  - Removed: applyDomainPenalties(), checkDomainIsolation(), isDegraded()
  - Removed: reward bonuses, advisory_adjusted_confidence, platform_streak_modifier
  - New behavior: Alpha's base_confidence = final_confidence. No arithmetic applied.

  ### 2. daily-narrative-builder.ts — STRATEGY GUIDANCE STRIPPED
  - Removed: Session-mode strategy instructions and directional sweep conclusions
  - Replaced with: Raw factual measurements only

  ### 3. coordinator-alpha.ts — PROMPT INJECTION FIXED
  - Removed: dailyNarrative.dailyBias ("BULLISH"/"BEARISH") from Alpha's prompt
  - Replaced with: Raw OHLC levels and neutral factual observations

  ### 4. multi-symbol-ranker.ts — RECOMMENDATION LABELS REMOVED
  - Removed: recommendation, reasoning, cachedConsensus fields
  - Raw numeric dimension scores only

  ### 5. regime-bucketing.ts — CCIP GOVERNANCE GUARD ADDED
  - getRecommendedModesForBucket() restricted to internal playbook matching only

  ### 6. forecast-engine.ts — NARRATIVE REASONING STRINGS REPLACED
  - Replaced conclusion-style strings with raw measurement strings

  ### 7. alpha-omega-orchestrator.ts — MODIFIER ASSEMBLY FULLY REMOVED
  - Removed: All 5 domain confidence modifiers, reward system, penalty methods
  - finalConfidence = originalConfidence (Alpha's value, unchanged)

  ## Governance Rule (Non-Negotiable)
  Alpha's base_confidence IS final_confidence.
  No domain authority may apply arithmetic modifiers of any kind.
  This contract is permanent and irreversible.
*/

-- Document the governance change in the platform settings table
INSERT INTO platform_settings (setting_key, setting_value, description, updated_at)
VALUES (
  'ccip_alpha_sovereignty_2026_03_20',
  jsonb_build_object(
    'status', 'ACTIVE',
    'enacted_at', now()::text,
    'governance_rule', 'Alpha base_confidence IS final_confidence. No domain may apply arithmetic modifiers.',
    'files_changed', jsonb_build_array(
      'confidence-calculation-engine.ts',
      'daily-narrative-builder.ts',
      'coordinator-alpha.ts',
      'multi-symbol-ranker.ts',
      'regime-bucketing.ts',
      'forecast-engine.ts',
      'alpha-omega-orchestrator.ts'
    ),
    'penalty_domains_removed', jsonb_build_array(
      'eqs', 'narrative', 'regime_oracle',
      'adversarial', 'session_advisor', 'pattern_confidence', 'platform_streak'
    )
  ),
  'CCIP Alpha Sovereignty Completion — all pre-reasoning layers and confidence penalty infrastructure permanently removed',
  now()
)
ON CONFLICT (setting_key) DO UPDATE
  SET setting_value = EXCLUDED.setting_value,
      description = EXCLUDED.description,
      updated_at = now();

-- Add deprecation comments to confidence_calculation_audit penalty columns if they exist
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'confidence_calculation_audit'
      AND column_name = 'eqs_penalty'
  ) THEN
    COMMENT ON COLUMN confidence_calculation_audit.eqs_penalty
      IS 'DEPRECATED 2026-03-20 (CCIP): EQS penalty system removed. Always NULL for new rows.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'confidence_calculation_audit'
      AND column_name = 'narrative_penalty'
  ) THEN
    COMMENT ON COLUMN confidence_calculation_audit.narrative_penalty
      IS 'DEPRECATED 2026-03-20 (CCIP): Narrative penalty system removed. Always NULL for new rows.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'confidence_calculation_audit'
      AND column_name = 'regime_oracle_penalty'
  ) THEN
    COMMENT ON COLUMN confidence_calculation_audit.regime_oracle_penalty
      IS 'DEPRECATED 2026-03-20 (CCIP): Regime oracle penalty system removed. Always NULL for new rows.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'confidence_calculation_audit'
      AND column_name = 'advisory_adjusted_confidence'
  ) THEN
    COMMENT ON COLUMN confidence_calculation_audit.advisory_adjusted_confidence
      IS 'DEPRECATED 2026-03-20 (CCIP): Advisory-adjusted value no longer computed. Equals base_confidence for all new rows.';
  END IF;
END $$;
