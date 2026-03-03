/*
  # CCIP-TYPE-CONTRACT-FIX-2026-03-03

  ## Summary
  Governance audit trail for four critical/high fixes applied to the regime signature
  type contract, thesis TTL documentation, freshness gate thresholds, and ATR conflict
  resolution logic.

  ## Section 1: Extend valid_entity_type constraint
  Adds 'alpha_type_contract', 'alpha_freshness_gate', 'alpha_regime_extractor',
  and 'thesis_immutability_guard' as valid entity types for architectural fixes.

  ## Changes Audited

  1. RegimeSignature interface (CRITICAL) — alpha-thesis.ts
     Enum values corrected to match extractor runtime output. TypeScript as-casts were
     bypassing the type system, causing detectRegimeChange() to silently fail.

  2. Stale CCIP comment (HIGH) — alpha-thesis.ts
     CCIP-STALENESS-FIX-2026-02-20 "5 minutes" rationale corrected to 15 minutes.

  3. Freshness gate thresholds (HIGH) — trade-execution-freshness-gate.ts
     SEVERITY_THRESHOLDS.alpha now derives from TIME_MS.CACHE.ALPHA_THESIS (SSOT).
     Eliminates 10-minute dead zone between cache TTL and execution gate.

  4. ATR conflict resolution (HIGH) — regime-signature-extractor.ts
     Explicit logger.warn when ATR_EXPANDING + ATR_CONTRACTING both present simultaneously.

  5. Immutability guard SSOT fix (MEDIUM) — thesis-immutability-guard.ts
     MAX_AGE_SECONDS derived from THESIS_TTL_MS / 1000 instead of hardcoded 900.

  ## Security
  No RLS changes. No table data changes. Governance constraint extension and audit records only.
*/

ALTER TABLE governance_change_log
  DROP CONSTRAINT IF EXISTS valid_entity_type;

ALTER TABLE governance_change_log
  ADD CONSTRAINT valid_entity_type CHECK (entity_type = ANY (ARRAY[
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
    'alpha_wall_validation',
    'alpha_prompt_config',
    'llm_pipeline_governance',
    'alpha_type_contract',
    'alpha_freshness_gate',
    'alpha_regime_extractor',
    'thesis_immutability_guard'
  ]));

INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason,
  metadata
)
VALUES
  (
    'alpha_type_contract',
    gen_random_uuid(),
    'configuration_change',
    '{"htfBias": "bullish|bearish|neutral", "microRegime": "accumulation|distribution|expansion|rotation", "volatilityRegime": "compressed|normal|expanding", "structureState": "trending|ranging|transition"}'::jsonb,
    '{"htfBias": "strongly_bullish|bullish|strongly_bearish|bearish|ranging", "microRegime": "reversal_setup|range_bound|trending|consolidation", "volatilityRegime": "high_volatility|low_volatility|normal_volatility", "structureState": "strong_trend|weak_trend|consolidating|choppy"}'::jsonb,
    'CRITICAL: RegimeSignature interface enum values did not match extractor runtime output. TypeScript as-casts bypassed type system. detectRegimeChange() string equality silently failed — cache never invalidated on regime changes.',
    '{"ccip": "CCIP-TYPE-CONTRACT-FIX-2026-03-03", "severity": "CRITICAL", "files": ["src/types/alpha-thesis.ts"]}'::jsonb
  ),
  (
    'alpha_freshness_gate',
    gen_random_uuid(),
    'configuration_change',
    '{"infoMaxAge": 60, "warningMaxAge": 120, "criticalMaxAge": 300}'::jsonb,
    '{"infoMaxAge": "~300s (33% of TTL)", "warningMaxAge": "~600s (67% of TTL)", "criticalMaxAge": "900s (100% of TTL)", "source": "ALPHA_TTL_SECONDS = TIME_MS.CACHE.ALPHA_THESIS / 1000"}'::jsonb,
    'HIGH: Previous freshness gate alpha thresholds blocked execution for 10 of 15 minutes of a structurally valid cached thesis. Dead zone eliminated by deriving thresholds from ALPHA_TTL_SECONDS (SSOT).',
    '{"ccip": "CCIP-TYPE-CONTRACT-FIX-2026-03-03", "severity": "HIGH", "files": ["src/services/trade-execution-freshness-gate.ts"]}'::jsonb
  ),
  (
    'alpha_regime_extractor',
    gen_random_uuid(),
    'configuration_change',
    '{"policy": "silent_first_match", "conflict_logging": false}'::jsonb,
    '{"policy": "ATR_EXPANDING_takes_precedence", "conflict_logging": true, "log_level": "warn"}'::jsonb,
    'HIGH: Contradictory ATR signals (ATR_EXPANDING + ATR_CONTRACTING simultaneously) were silently resolved without logging. Now emits governance warn for observability.',
    '{"ccip": "CCIP-TYPE-CONTRACT-FIX-2026-03-03", "severity": "HIGH", "files": ["src/services/regime-signature-extractor.ts"]}'::jsonb
  ),
  (
    'thesis_immutability_guard',
    gen_random_uuid(),
    'configuration_change',
    '{"MAX_AGE_SECONDS": "900 (hardcoded literal)"}'::jsonb,
    '{"MAX_AGE_SECONDS": "THESIS_TTL_MS / 1000 (SSOT: alpha-thesis.ts -> time-constants.ts)"}'::jsonb,
    'MEDIUM: Hardcoded MAX_AGE_SECONDS=900 in thesis-immutability-guard.ts violated SSOT. Now derived from canonical THESIS_TTL_MS constant.',
    '{"ccip": "CCIP-TYPE-CONTRACT-FIX-2026-03-03", "severity": "MEDIUM", "files": ["src/services/thesis-immutability-guard.ts"]}'::jsonb
  );
