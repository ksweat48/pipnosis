/*
  # CCIP Governance Record: Alpha Professional Reasoning Framework

  ## Summary
  This migration records the architectural governance decision to replace Alpha's
  rule-engine prompt with a Professional Analytical Briefing Framework.

  ## What Changed
  This is a PROMPT ARCHITECTURE change, not a schema change. The database record
  exists to satisfy CCIP governance requirements: all significant architectural
  changes must be tracked in the ccip_tier7_tracking table.

  ## The Change
  - BEFORE: Alpha's system prompt was a mechanical rule engine with auto-blocks,
    penalty tables, and "AUTO NO_TRADE" pattern lists. This micromanaged Alpha's
    decisions and prevented LLM reasoning from operating at full depth.
  - AFTER: Alpha's system prompt is a Professional Analytical Briefing Framework.
    Hard blocks remain for mathematical/structural impossibilities only.
    Everything else is converted to analytical questions Alpha must reason through
    using its LLM knowledge. Alpha now surfaces its own red flags rather than
    having the prompt enumerate them.

  ## Hard Blocks (unchanged — these remain mandatory rejections)
  1. GEOMETRY_VIOLATION — BUY: SL < Entry < TP, SELL: TP < Entry < SL
  2. ZERO_DISTANCE_SL_TP — SL or TP at same price as entry
  3. RR_FLOOR_VIOLATION — R:R below style minimum after structural SL placement
  4. NOISE_FLOOR_VIOLATION — SL closer to entry than statistical noise floor
  5. DATA_STALE, BROKEN_FEED, MARKET_CLOSED, SPREAD_EXCEEDS_PROFIT

  ## Analytical Tools (converted from auto-blocks to mandatory reasoning triggers)
  - FAILED_SETUP_PATTERNS (M5 inside bars, whipsaw, consolidation) → Red flags
    requiring explicit Alpha reasoning, not automatic rejections
  - EQS score → Market context indicator, not a confidence penalty table
  - Regime/session/adversarial advisories → Reasoning inputs, not confidence gates

  ## New Required Output Fields
  - counter_thesis: Alpha must name the primary reason the trade fails before executing
  - reasoning: Must now demonstrate all six analytical questions were considered

  ## Governance Compliance
  - SSOT: getAlphaSystemPromptForStyle(style) in alpha-identity.ts is the single source of truth
    (parameterless getAlphaSystemPrompt() was removed entirely — it had one call site
    and no backward-compatibility requirement; replaced by the style-aware version)
  - CCIP: This migration records the change for audit and rollback tracking
  - Architecture: Hard blocks remain enforced in alpha-trade-executor.ts validation
    pipeline — this change only affects the LLM prompt, not post-decision validation
*/

DO $$
BEGIN
  INSERT INTO ccip_tier7_tracking (
    change_type,
    component,
    description,
    impact_assessment,
    rollback_strategy,
    approved_by
  )
  VALUES (
    'PROMPT_ARCHITECTURE',
    'alpha-identity.ts:getAlphaSystemPromptForStyle + coordinator-alpha.ts:openAIClient.chat system role',
    'Replace mechanical rule-engine prompt with Professional Analytical Briefing Framework. getAlphaSystemPromptForStyle(style) is now placed in the OpenAI system role (stronger instruction-following weight). Hard blocks preserved for geometry/RR/noise-floor/data-integrity violations. FAILED_SETUP_PATTERNS converted from AUTO NO_TRADE to mandatory reasoning triggers. EQS converted from penalty table to market context signal. counter_thesis field added as required output for every BUY/SELL decision.',
    'HIGH — directly affects Alpha LLM decision quality. Expected improvement: better contextual reasoning, fewer missed traps (double tops etc), more honest confidence scores, preserved execution rate for genuine setups.',
    'Revert getAlphaSystemPromptForStyle() placement from system role back to user role prefix in coordinator-alpha.ts. Post-decision validation pipeline in alpha-trade-executor.ts is unchanged and continues to enforce all hard blocks independently.',
    'system'
  )
  ON CONFLICT DO NOTHING;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
  WHEN undefined_column THEN
    NULL;
END $$;
