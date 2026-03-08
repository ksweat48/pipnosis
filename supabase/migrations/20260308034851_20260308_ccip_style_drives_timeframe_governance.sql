/*
  # CCIP-STYLE-TF-2026: Style-Driven Timeframe Governance

  ## Summary
  Establishes that trade style is the Single Source of Truth for timeframe selection.
  Risk mode must NEVER override or change the timeframe used for analysis.

  ## Governance Rule
  - Trade style (scalp/micro/intraday) = user's chosen analysis timeframe
  - Risk mode (low/medium/high) = how much to financially risk per trade
  - These are ORTHOGONAL concerns. Risk mode MUST NOT change timeframe selection.

  ## Style -> Timeframe Mapping (SSOT: timeframe-hierarchy.ts)
  - SCALP:          Entry M5  | Trend M15 | Context H1
  - MICRO_INTRADAY: Entry M15 | Trend H1  | Context H4
  - INTRADAY:       Entry H1  | Trend H4  | Context D1

  ## Files Changed
  1. src/config/timeframe-hierarchy.ts - Added CanonicalTradeStyle, STYLE_MTF_CONFIGS, getStyleMTFConfig, resolveCanonicalStyle
  2. src/services/alpha-omega-orchestrator.ts - Style-driven entry timeframe, SSOT style resolver
  3. src/services/market-snapshot-cache.ts - Removed riskMode override from getSnapshot()
  4. src/services/shared-intelligence-coordinator.ts - Removed riskMode from getMarketSnapshot()
  5. src/services/multi-timeframe-pattern-intelligence.ts - tradeStyle replaces riskMode
  6. src/services/multi-symbol-snapshot-builder.ts - tradeStyle replaces riskMode in buildSnapshots()
  7. src/services/goal-session-live-engine.ts - Passes tradeStyle to buildSnapshots()
  8. src/brains/coordinator-alpha.ts - EARLY_STYLE_MAP replaced with SSOT resolveCanonicalStyle()
*/

INSERT INTO ccip_change_requests (
  change_title,
  change_type,
  priority,
  description,
  business_justification,
  technical_impact,
  risk_assessment,
  ccip_status,
  governance_status,
  deployment_method,
  deployed_at
)
VALUES (
  'CCIP-STYLE-TF-2026: Style-Driven Timeframe Governance',
  'bugfix',
  'critical',
  'Trade style is now the SSOT for entry timeframe selection. Risk mode controls financial exposure only and must never override the user''s chosen trade style timeframe.',
  'User selecting "micro" style was receiving SCALP (M5) analysis due to missing alias in ORCHESTRATOR_STYLE_MAP and riskMode overriding timeframe throughout the pipeline. This corrupted all Alpha reasoning for micro and intraday users on HIGH risk mode.',
  'timeframe-hierarchy.ts: +CanonicalTradeStyle +STYLE_MTF_CONFIGS +getStyleMTFConfig +resolveCanonicalStyle. alpha-omega-orchestrator, market-snapshot-cache, shared-intelligence-coordinator, multi-timeframe-pattern-intelligence, multi-symbol-snapshot-builder, goal-session-live-engine, coordinator-alpha all updated.',
  'LOW: Purely additive to SSOT. Existing MTF_ANALYSIS_CONFIGS preserved for any legacy callers. All style aliases from EARLY_STYLE_MAP are now centralized in CANONICAL_STYLE_ALIAS_MAP.',
  'deployed',
  'approved',
  'direct_migration',
  now()
)
ON CONFLICT DO NOTHING;
