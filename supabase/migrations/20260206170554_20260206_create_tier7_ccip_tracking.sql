/*
  # TIER 7 Directional Bias Elimination - CCIP Tracking

  1. Purpose
    - Track CCIP-compliant fixes for TIER 7 architectural issues
    - Eliminate BUY-only bias in Volatility Brain
    - Remove hardcoded direction strings
    - Replace hardcoded pip values with SSOT currency helpers

  2. Changes
    - Create CCIP tracking for volatility brain directional voting
    - Create CCIP tracking for thesis classification integration
    - Create CCIP tracking for pip value standardization

  3. Governance
    - All changes follow SSOT principles
    - No duplicate logic across services
    - Single source of truth for pip calculations
*/

-- Track TIER 7 fixes in CCIP system
INSERT INTO ccip_change_requests (
  change_type,
  change_title,
  description,
  business_justification,
  technical_impact,
  risk_assessment,
  ccip_status,
  governance_status,
  priority,
  modified_files,
  database_changes,
  breaking_changes
) VALUES
(
  'refactor',
  'TIER 7: Eliminate Volatility Brain BUY-Only Bias',
  'Add candidateDirection support to Volatility Brain, enabling proper SELL voting capability. Currently the brain can only vote BUY or NO_TRADE, never SELL.',
  'Critical directional bias prevents 50% of valid trade opportunities. System cannot identify bearish volatility setups.',
  'Updates VolatilitySnapshot interface and Omega Volatility Brain voting logic. Affects alpha-omega-orchestrator.ts caller code.',
  'Low - Pure logic fix with no database changes. Enables missing functionality.',
  'approved',
  'approved',
  'critical',
  ARRAY['src/brains/omega/volatility.ts', 'src/services/alpha-omega-orchestrator.ts'],
  false,
  false
),
(
  'refactor',
  'TIER 7: Wire Thesis Classification Engine',
  'Replace hardcoded BUY direction with dynamic thesis classification based on market context. Thesis engine exists but is not imported or used anywhere.',
  'Current hardcoded BUY direction creates systematic long bias. Market-aware direction determination is critical for adaptive execution.',
  'Wires up thesis-classification-engine.ts across entry quality advisor and alpha validation services. Removes all hardcoded direction strings.',
  'Low - Connects existing unused code. No new logic introduced.',
  'approved',
  'approved',
  'critical',
  ARRAY['src/services/thesis-classification-engine.ts', 'src/services/entry-quality-advisor-service.ts', 'src/services/alpha-validation-service.ts'],
  false,
  false
),
(
  'refactor',
  'TIER 7: Replace Hardcoded Pip Values with SSOT',
  'Replace all hardcoded 0.0001 pip values with getCurrencyPipInfo() SSOT utility. Found 25+ files with hardcoded pip assumptions.',
  'Hardcoded pip values break for JPY, indices, and crypto. SSOT currency helpers provide correct pip values per instrument class.',
  'Updates 25+ service files to use getCurrencyPipInfo() and calculatePipDistance() from currencyHelpers.ts. Eliminates duplicate pip logic.',
  'Medium - Widespread changes but purely replacements with SSOT functions. Improves accuracy for non-forex instruments.',
  'approved',
  'approved',
  'critical',
  ARRAY[
    'src/services/llm-mid-trade-evaluator.ts',
    'src/services/mid-trade-monitor-service.ts', 
    'src/services/mid-trade-trigger-detector.ts',
    'src/services/multi-symbol-ranker.ts',
    'src/services/daily-narrative-builder.ts',
    'src/services/goal-session-live-engine.ts'
  ],
  false,
  false
);
