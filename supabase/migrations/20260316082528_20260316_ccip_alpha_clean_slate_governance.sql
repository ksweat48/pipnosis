/*
  # CCIP-2026-0316B: Alpha Clean Slate Governance Record

  ## Summary
  Records the architectural change removing all hidden trading rules and instructions
  from Alpha's system prompt and the coordinator briefing pipeline.

  ## What Was Removed
  - All session-specific rules (Dead Zone, Asian Session per instrument class)
  - Velocity arithmetic templates (SUFFICIENT/BORDERLINE/EXTENDED with hardcoded minutes)
  - Move stage ATR multiplier thresholds with action instructions
  - Volatility regime strategy prescriptions
  - Counter-trend confluence number suggestions
  - Kill zone UTC times with trading instructions
  - R:R target band instructions
  - buildAdvancedPatternsContext() injection pipeline from coordinator-alpha.ts
  - REGIME_STYLE_ADAPTATIONS, SESSION_PROFILES, LIQUIDITY_PLAYBOOK imports
  - Dead constants: VOLATILITY_REGIME_THRESHOLDS, SCALP_TIME_CONTRACT,
    CONFLUENCE_DIMENSIONS, CONFLUENCE_REQUIREMENTS

  ## What Remains
  - Arena walls only (mathematical/physics impossibilities)
  - Open analytical questions (Q1-Q9) — not pre-answered for Alpha
  - Full audit schema (required output fields)
  - Alpha identity statement

  ## Governance Compliance
  - SSOT: alpha-identity.ts is the sole authority for Alpha's system prompt
  - CCIP: Change recorded in ccip_change_tracking
  - No hidden rules remain in any prompt or coordinator method
*/

INSERT INTO ccip_change_tracking (
  id,
  user_id,
  operation_type,
  table_name,
  record_id,
  change_details,
  created_at,
  updated_at
)
VALUES (
  gen_random_uuid(),
  '30177afc-5b98-41ab-832a-a3e5a875e6c0',
  'ARCHITECTURAL_CHANGE',
  'alpha_identity',
  gen_random_uuid(),
  jsonb_build_object(
    'change_ref', 'CCIP-2026-0316B',
    'description', 'Alpha Clean Slate — removed all hidden trading rules from system prompt and coordinator briefing pipeline',
    'files_modified', jsonb_build_array(
      'src/config/alpha-identity.ts',
      'src/brains/coordinator-alpha.ts'
    ),
    'removed', jsonb_build_array(
      'getAlphaSystemPromptForStyle hidden rules (session rules, velocity arithmetic, ATR thresholds, regime prescriptions, kill zones, R:R bands)',
      'buildAdvancedPatternsContext() method and all supporting helpers',
      'REGIME_STYLE_ADAPTATIONS / SESSION_PROFILES / LIQUIDITY_PLAYBOOK imports',
      'Dead constants: VOLATILITY_REGIME_THRESHOLDS, SCALP_TIME_CONTRACT, CONFLUENCE_DIMENSIONS, CONFLUENCE_REQUIREMENTS'
    ),
    'retained', jsonb_build_array(
      'Arena walls (mathematical/physics impossibilities only)',
      'Open analytical questions Q1-Q9 (not pre-answered)',
      'Full audit output schema',
      'All raw data feeds (candles, EMA, ATR, Omega votes, adversarial, regime, liquidity)'
    ),
    'governance', 'SSOT compliant — alpha-identity.ts is sole authority for Alpha system prompt'
  ),
  now(),
  now()
);
