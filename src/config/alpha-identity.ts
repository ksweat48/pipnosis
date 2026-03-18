/**
 * Alpha Identity Configuration - Single Source of Truth
 *
 * ═══════════════════════════════════════════════════════════════════
 * ALPHA PROFESSIONAL TRADING IDENTITY
 * ═══════════════════════════════════════════════════════════════════
 *
 * This file defines Alpha's behavioral rules, confidence thresholds,
 * and decision framework. ALL modules must reference this file for
 * Alpha-related configuration.
 *
 * ARCHITECTURE:
 * - Alpha is the FINAL AUTHORITY on trade decisions
 * - Advisory systems (Regime Oracle, Adversarial Detector) provide guidance only
 * - Only legitimate block conditions can prevent trade execution
 * - Three decisions only: BUY/SELL (execute_now or wait_pullback) or NO_TRADE
 *
 * SSOT COMPLIANCE:
 * - Confidence thresholds: THIS FILE
 * - EQS thresholds by style: THIS FILE (all reference EQS_EXECUTION_THRESHOLD)
 * - Legitimate block conditions: THIS FILE
 * - Advisory system designations: THIS FILE
 * ═══════════════════════════════════════════════════════════════════
 */

/**
 * EQS REFERENCE VALUE — CONTEXT ONLY, NOT A GATE
 *
 * CCIP-2026-0318B: EQS is no longer an execution gate.
 * This value is retained only as a named reference for display and logging.
 * No module may use this value to block or approve a trade.
 * Alpha receives the EQS score as market context and reasons about it directly.
 *
 * 75-POINT SCALE:
 * Core structure (pullback + EMA + VWAP) is sufficient for entry.
 * Patterns are enhancers, not gatekeepers.
 * Alpha self-weights EQS against the full market picture.
 */
const EQS_EXECUTION_THRESHOLD = 40;

/**
 * EQS-TO-CONFIDENCE MODIFIER — INFORMATION ONLY (NO PENALTIES)
 *
 * CCIP GOVERNANCE: EQS is a market context tool passed to Alpha for reasoning.
 * It describes the quality of the current entry structure.
 * EQS does NOT reduce confidence scores. Alpha sees the EQS value and reasons
 * about it directly in his analytical framework.
 *
 * Positive rewards for exceptional timing are preserved — they represent
 * alignment bonuses when market structure is textbook quality.
 * All negative modifiers (penalties) have been removed.
 *
 * Philosophy: Alpha needs to see poor entry quality as information, not as
 * a code-imposed penalty. If the entry structure is weak, Alpha will factor
 * that into his confidence output directly. Penalizing his confidence via code
 * distorts his output without giving him the knowledge to reason differently.
 *
 * 75-POINT SCALE:
 * REWARDS (Above 50):
 * - 75+: +5 points (exceptional timing — textbook entry structure)
 * - 70-74: +4 points
 * - 65-69: +3 points
 * - 60-64: +2 points
 * - 55-59: +1 points
 * - 50 and below: +0 points (neutral — Alpha reasons about EQS directly)
 */
export const EQS_CONFIDENCE_MODIFIERS = [
  { minEQS: 75, modifier: 5 },
  { minEQS: 70, modifier: 4 },
  { minEQS: 65, modifier: 3 },
  { minEQS: 60, modifier: 2 },
  { minEQS: 55, modifier: 1 },
  { minEQS: 0, modifier: 0 },
] as const;


/**
 * EQS COMPONENT MAXIMUMS - 75-POINT SCALE SSOT
 * These constants define the maximum points for each component.
 * ALL display, logging, and calculation code MUST reference these values.
 */
export const EQS_COMPONENT_MAXIMUMS = {
  TOTAL: 75,
  PULLBACK_QUALITY: 20,
  VWAP_INTERACTION: 15,
  EMA_ALIGNMENT: 15,
  LIQUIDITY_REACTION: 10,
  COMPRESSION_EXPANSION: 5,
  FAILED_MOVE: 5,
  TIMEFRAME_ALIGNMENT: 5,
  FRICTION_PENALTY_MAX: -15, // Penalty (negative)
  APLUS_BONUS_MAX: 15,        // Bonus (positive)
} as const;

/**
 * EQS GRADE THRESHOLDS - 75-POINT SCALE
 * SSOT for grade calculation boundaries
 */
export const EQS_GRADE_THRESHOLDS = {
  A_PLUS: 60,  // 80% of 75
  A: 54,       // 72% of 75
  B: 49,       // 65% of 75
  C: 38,       // 50% of 75
  D: 23,       // 30% of 75
  F: 0,        // Below 30%
} as const;

/**
 * EDGE LOSS TIME LIMITS - ABSOLUTE THRESHOLDS PER STYLE
 *
 * After these time limits, edge loss modal is triggered to alert the user.
 * These are ABSOLUTE limits, not progressive phases.
 * No threshold decay, no zone tolerance relaxation.
 *
 * Style-Specific Max Wait Times:
 * - SCALP: 10 minutes (fast execution style)
 * - MICRO_INTRADAY: 45 minutes (structured patience)
 * - INTRADAY: 120 minutes (patient positioning)
 */
export const EDGE_LOSS_TIME_LIMITS = {
  SCALP: 10,              // 10 minutes max wait
  MICRO_INTRADAY: 45,     // 45 minutes max wait
  INTRADAY: 120,          // 120 minutes max wait
} as const;


/**
 * ALPHA_TRADER_STATEMENT_FIELDS — SSOT for required audit output fields
 *
 * CCIP-2026-0310A: Defines the mandatory reasoning fields Alpha must provide
 * in every BUY/SELL response to enable full audit traceability. These fields
 * are parsed and stored alongside every trade decision.
 *
 * trader_statement: Alpha's full reasoning in trader voice — not a checklist,
 *   but a professional explanation of the trade from market read to exit plan.
 * sl_structural_reference: Named structural level behind the SL with invalidation logic.
 * tp_structural_reference: Named structural level or liquidity zone at the TP.
 * estimated_duration_minutes: Alpha's own estimate of how long the trade runs.
 * edge_summary: 1-2 sentence distillation of why this specific setup has edge.
 */
export const ALPHA_TRADER_STATEMENT_FIELDS = [
  'trader_statement',
  'sl_structural_reference',
  'tp_structural_reference',
  'estimated_duration_minutes',
  'edge_summary',
] as const;

export type AlphaTraderStatementField = typeof ALPHA_TRADER_STATEMENT_FIELDS[number];

/**
 * ADAPTIVE CONFIDENCE FLOOR RAILS — SSOT
 *
 * CCIP-2026-0308A: Bidirectional Floor Authority
 *
 * Alpha's execution floor is adaptive — it moves both up AND down based on
 * calibration data from alpha_confidence_calibration. Hard system rails prevent
 * extremes that would either expose capital (too low) or lock Alpha out of
 * all valid setups (too high).
 *
 * FLOOR_DEFAULT: Where every session starts. Matches MINIMUM_TRADE_CONFIDENCE.
 * FLOOR_HARD_MIN: Absolute lower bound. Alpha cannot lower below this regardless
 *   of data. Protects against systematic over-acceptance of low-conviction trades.
 * FLOOR_HARD_MAX: Absolute upper bound. Alpha cannot raise above this regardless
 *   of data. Protects against data-driven lockout where no trade ever qualifies.
 * FLOOR_STEP: Increment/decrement unit. One bucket width (5 points) per adjustment.
 *   Prevents erratic jumps from a single calibration event.
 *
 * SAMPLE_SIZE_THRESHOLD_DOWN: Minimum trades in a bucket to allow floor lowering.
 *   Lower bar — relaxing the floor is less risky, needs less evidence.
 * SAMPLE_SIZE_THRESHOLD_UP: Minimum trades in a bucket to allow floor raising.
 *   Higher bar — raising the floor restricts trading and punishes future sessions.
 *   Requires stronger evidence before becoming more selective.
 *
 * CALIBRATION_ERROR_THRESHOLD: Minimum miscalibration magnitude to trigger any
 *   adjustment. Prevents noise from bouncing the floor on small deviations.
 *   A bucket must be wrong by this many percentage points before Alpha acts.
 *
 * AUTHORITY: This object is the ONLY place these rails are defined.
 * alpha-adaptive-floor-service.ts reads these values. No other file hardcodes them.
 */
export const ADAPTIVE_FLOOR_RAILS = {
  FLOOR_DEFAULT: 60,
  FLOOR_HARD_MIN: 50,
  FLOOR_HARD_MAX: 75,
  FLOOR_STEP: 5,
  SAMPLE_SIZE_THRESHOLD_DOWN: 10,
  SAMPLE_SIZE_THRESHOLD_UP: 15,
  CALIBRATION_ERROR_THRESHOLD: 10,
} as const;

export const ALPHA_IDENTITY = {
  MINIMUM_TRADE_CONFIDENCE: 50, // CCIP-2026-01-19: Lowered from 60 to 50. EQS penalties degrade intelligently below 50 → WAIT. Hard reject at 60 was blocking valid low-confidence setups.

  CONFIDENCE_BANDS: {
    EXCELLENT: { min: 85, max: 100, description: 'Excellent setup - Strong confluence' },
    SOLID: { min: 70, max: 84, description: 'Solid setup - Good conditions' },
    ACCEPTABLE: { min: 50, max: 69, description: 'Acceptable setup - Modest edge' },
    INSUFFICIENT: { min: 0, max: 49, description: 'Insufficient edge - NO_TRADE' },
  },

  /**
   * EQS_EXECUTION_THRESHOLD — REFERENCE ONLY (NOT A GATE)
   *
   * CCIP-2026-0318B: This value is kept for display, logging, and EQS reward
   * calculations only. It does not gate or approve trade execution.
   * Alpha receives EQS as market context and reasons about it directly.
   */
  EQS_EXECUTION_THRESHOLD,
  EQS_EXCEPTIONAL_OVERRIDE_THRESHOLD: 56,  // Reference value for display — not a gate

  LEGITIMATE_BLOCK_CONDITIONS: [
    'DATA_STALE',
    'INVALID_STOP_LOSS',
    'SPREAD_EXCEEDS_PROFIT',
    'BROKEN_FEED',
    'MARKET_CLOSED',
    'ZERO_DISTANCE_SL_TP',
    'MTF_DATA_MISSING',
    'PRIMARY_TF_DATA_MISSING',
    'NO_NAMED_STRUCTURE',
    'TOKEN_BUDGET_EXCEEDED',
  ] as const,

  ADVISORY_SYSTEMS: {
    REGIME_ORACLE: {
      name: 'Regime Oracle',
      type: 'ADVISORY' as const,
      canBlock: false,
    },
    ADVERSARIAL_DETECTOR: {
      name: 'Adversarial Detector',
      type: 'ADVISORY' as const,
      canBlock: false,
      mode: 'INFORM_ONLY' as const,
    },
    SESSION_CONSTRAINTS: {
      name: 'Session Constraints',
      type: 'ADVISORY' as const,
      canBlock: false,
    },
    OMEGA_CONSENSUS: {
      name: 'Omega Consensus',
      type: 'ADVISORY' as const,
      canBlock: false,
    },
  },

  /**
   * MAX_ADVISORY_PENALTY — prompt-level advisory guidance ceiling
   *
   * CCIP-2026-0310-OMEGA / CCIP-2026-02-19:
   *
   * Advisory systems (Regime Oracle, Adversarial Detector, Session Constraints)
   * pass their signals to Alpha as text in the briefing. Alpha self-prices those
   * signals into his stated trade_confidence. No code arithmetic is applied to
   * Alpha's confidence after he outputs it.
   *
   * This value is passed into the Alpha prompt to set Alpha's expectation: the
   * combined effect of all advisory signals on his reasoning should not exceed
   * this ceiling. It is a reasoning guideline, not a code-enforced cap.
   *
   * Omega Council carries zero advisory weight — Omega is a price-structure sensor
   * whose observations are inputs to Alpha's reasoning, not post-hoc deductions
   * from his stated confidence.
   *
   * SSOT: This constant is the single authority referenced by coordinator-alpha.ts
   * and pipnosis-core-rules.ts for the advisory guidance ceiling in the prompt.
   */
  MAX_ADVISORY_PENALTY: 10,
} as const;

export type LegitimateBlockCondition = typeof ALPHA_IDENTITY.LEGITIMATE_BLOCK_CONDITIONS[number];

export type StyleName = 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY';

export type AlphaAction = 'BUY' | 'SELL' | 'NO_TRADE';

export type EntryMode = 'execute_now' | 'wait_pullback' | 'push_confirmation';

export type ThesisType =
  | 'momentum_scalp'
  | 'liquidity_sweep_reversal'
  | 'trend_pullback'
  | 'breakout_continuation'
  | 'mean_reversion'
  | 'failed_move'
  | 'range_extreme';

export type StyleIntent = 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY';

export type ExecutionPreference = 'IMMEDIATE' | 'WAIT_PULLBACK' | 'WAIT_CONFIRMATION';

export interface AlphaTradeManagement {
  tp1_close_percent: number;
  sl_to_breakeven_after_tp1: boolean;
  trail_method: 'structure' | 'fixed_pips' | 'none';
  trail_notes?: string;
}

export interface AlphaOutputFormat {
  action: AlphaAction;
  trade_confidence: number;
  entry_quality_score: number;
  entry_mode: EntryMode;
  style: StyleName;
  confidence_anchor?: string;
  reasoning: string | {
    thesis_why?: string;
    market_behavior?: string;
    risk_acceptance?: string;
    objective_alignment?: string;
    tp_path_audit?: string;
    session_phase?: string;
    range_position?: string;
  };
  counter_thesis?: string;
  counter_thesis_probability?: number;
  entry?: number;
  stopLoss?: number;
  takeProfit?: number;
  wait_condition?: {
    target_entry_zone_min: number;
    target_entry_zone_max: number;
    invalidation_price: number;
    wait_reasoning: string;
  };
  thesis?: ThesisType;
  style_intent?: StyleIntent;
  execution_preference?: ExecutionPreference;
  acceptable_profit_range?: {
    minUSD: number;
    idealUSD: number;
  };
  trade_management?: AlphaTradeManagement | null;
  estimated_duration_minutes?: string | number;
  thesis_coherence_statement?: string;
}

export const EQS_WEIGHTED_FACTORS = {
  CANDLE_ACCEPTANCE: {
    name: 'Candle acceptance (body dominance, closes)',
    weight: 20,
    description: 'Body dominance ratio, closes in direction, consecutive closes',
  },
  PULLBACK_QUALITY: {
    name: 'Pullback quality / impulse structure',
    weight: 15,
    description: '38-50% retracement quality, impulse identification',
  },
  VWAP_INTERACTION: {
    name: 'VWAP interaction (kiss, reclaim, spread)',
    weight: 15,
    description: 'VWAP proximity, kiss patterns, spread from VWAP',
  },
  EMA_ALIGNMENT: {
    name: 'EMA alignment / slope / crossover',
    weight: 10,
    description: 'EMA20 alignment with direction, slope confirmation',
  },
  LIQUIDITY_REACTION: {
    name: 'Liquidity reaction (not detection)',
    weight: 15,
    description: 'Response to liquidity pools, sweep-reclaim patterns',
  },
  COMPRESSION_EXPANSION: {
    name: 'Compression to expansion',
    weight: 10,
    description: 'Tight range breakout patterns, compression detection',
  },
  FAILED_MOVE_CONFIRMATION: {
    name: 'Failed move confirmation',
    weight: 10,
    description: 'False breakout confirmation, exhaustion patterns',
  },
  TIMEFRAME_ALIGNMENT: {
    name: 'Timeframe alignment (M5 for entry)',
    weight: 5,
    description: 'M5 microstructure confirmation for entry timing',
  },
} as const;

export const EQS_TOTAL_WEIGHT = Object.values(EQS_WEIGHTED_FACTORS).reduce(
  (sum, factor) => sum + factor.weight,
  0
);

/**
 * Get EQS-based confidence modifier — INFORMATION ONLY (rewards only, no penalties)
 *
 * CCIP GOVERNANCE: EQS is passed to Alpha as context. Alpha reasons about entry
 * quality directly in his analytical framework. No code-level penalties applied.
 *
 * Returns a small positive reward for exceptional entry structure (EQS 55+).
 * Returns 0 for all other EQS values. Alpha's own confidence output reflects
 * his assessment of poor entry quality when he sees the EQS score.
 *
 * 75-POINT SCALE:
 * - EQS 75+: +5 points (exceptional structure bonus)
 * - EQS 70-74: +4 points
 * - EQS 65-69: +3 points
 * - EQS 60-64: +2 points
 * - EQS 55-59: +1 points
 * - EQS below 55: 0 points (Alpha reasons about this directly)
 */
export function getEQSConfidenceModifier(entryQualityScore: number): number {
  for (const tier of EQS_CONFIDENCE_MODIFIERS) {
    if (entryQualityScore >= tier.minEQS) {
      return tier.modifier;
    }
  }
  return 0;
}


export function shouldExecute(
  tradeConfidence: number,
  entryQualityScore: number,
  style?: StyleName
): boolean {
  // Apply EQS-based confidence modifier
  const eqsModifier = getEQSConfidenceModifier(entryQualityScore);
  const adjustedConfidence = tradeConfidence + eqsModifier;

  // Check if adjusted confidence meets minimum threshold
  return adjustedConfidence >= ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE;
}

export function getEntryMode(
  tradeConfidence: number,
  entryQualityScore: number,
  style?: StyleName
): EntryMode {
  // Apply EQS-based confidence modifier
  const eqsModifier = getEQSConfidenceModifier(entryQualityScore);
  const adjustedConfidence = tradeConfidence + eqsModifier;

  // If confidence meets minimum threshold, execute now — otherwise wait for pullback
  if (adjustedConfidence >= ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE) {
    return 'execute_now';
  }

  return 'wait_pullback';
}

export function isLegitimateBlockCondition(condition: string): boolean {
  return ALPHA_IDENTITY.LEGITIMATE_BLOCK_CONDITIONS.includes(
    condition as LegitimateBlockCondition
  );
}


/**
 * SSOT: Style-specific system prompt for Alpha's analytical framework.
 *
 * This is the SINGLE AUTHORITY for all three trade-style reasoning prompts.
 * coordinator-alpha.ts passes the resolved StyleName here — no other callers exist.
 *
 * CCIP COMPLIANCE: Any change to questions, thresholds, or style-specific language
 * MUST be made in this function only. Do not duplicate prompt fragments elsewhere.
 *
 * Replaces the former parameterless getAlphaSystemPrompt() which was removed entirely
 * because it had only one call site and no backward-compatibility requirement.
 */
/**
 * CCIP-2026-0317A: Alpha System Prompt — Professional Trader Voice
 *
 * GOVERNANCE AUTHORITY: This function is the SINGLE SOURCE OF TRUTH for Alpha's
 * identity and constraints. No other file may inject trading instructions into
 * Alpha's reasoning via the system prompt.
 *
 * DESIGN CONTRACT:
 * - Alpha embodies internalized professional trading judgment — not rule execution
 * - Arena walls only: mathematical impossibilities and data integrity failures
 * - No session rules, no ATR-ratio thresholds, no time band instructions
 * - No strategy prescriptions per regime, session, or instrument class
 * - Alpha reasons from raw data passed in the briefing
 * - Audit schema is required so every decision can be fully reviewed
 * - The answer_sheet is an AUDIT TRAIL — contradictions between it and the
 *   action taken MUST be explicitly resolved in thesis_coherence_statement
 *
 * What legitimately belongs here:
 * 1. Alpha's professional identity — internalized judgment, not declared authority
 * 2. Timeframe stack definition (which TFs this style uses)
 * 3. Hard arena walls — the mathematical/physics conditions that make a trade impossible
 * 4. Output schema — required fields for audit traceability
 * 5. Professional reasoning questions — the internal deliberation of a real trader
 *
 * CCIP CHANGE LOG:
 * - CCIP-2026-0316B: Clean Slate — removed all hardcoded strategy prescriptions
 * - CCIP-2026-0317A: Professional Trader Voice — replaced checklist-declaration with
 *   internalized professional reasoning. Removed "find a trade" bias. Model upgraded
 *   to GPT-4o. Answer sheet contradiction resolution made mandatory.
 * - CCIP-2026-0319A: Mixed-Signal Gap Fix — added explicit schema rules to the prompt:
 *   (1) wait_condition is mandatory (not optional) when entry_mode is wait_pullback or
 *   push_confirmation; (2) NO_TRADE responses must NOT include entry_mode or wait_condition.
 *   These rules close the LLM hallucination gap at the source. The parser and engine
 *   layers enforce the same invariant as defensive guards (SSOT: coordinator-alpha.ts).
 */
export function getAlphaSystemPromptForStyle(style: StyleName): string {
  const isMicro = style === 'MICRO_INTRADAY';
  const isIntraday = style === 'INTRADAY';
  const isScalp = style === 'SCALP';
  const primaryTF = isScalp ? 'M5' : isMicro ? 'M15' : 'H1';
  const controlTF = isScalp ? 'M15' : isMicro ? 'H1' : 'H4';
  const confirmationTF = isMicro ? 'M5' : isIntraday ? 'M15' : 'M1';

  const arenaWalls = `HARD STOPS — mathematical impossibilities only:
- GEOMETRY: BUY requires SL < Entry < TP. SELL requires TP < Entry < SL. Any inversion = no structure.
- ZERO DISTANCE: SL or TP at entry = no structure.
- DATA: DATA_STALE | BROKEN_FEED | MARKET_CLOSED | SPREAD_EXCEEDS_PROFIT | PRIMARY_TF_DATA_MISSING
- CONTROL TF ABSENT: ${controlTF} absent or fewer than 5 candles.
- NOISE FLOOR: SL inside spread + noise floor = liquidated before thesis plays.
- TIER-1 NEWS: Active Tier-1 event = price is not market structure.
Outside these conditions, I decide. Nothing else blocks me.`;

  const auditSchema = `OUTPUT SCHEMA — every field is mandatory for governance audit:

BUY or SELL:
{
  "action": "BUY|SELL",
  "entry": <price>,
  "stopLoss": <price>,
  "takeProfit": <price>,
  "thesis": "momentum_scalp|liquidity_sweep_reversal|trend_pullback|breakout_continuation|mean_reversion|failed_move|range_extreme",
  "style_intent": "${style}",
  "execution_preference": "IMMEDIATE|WAIT_PULLBACK|WAIT_CONFIRMATION",
  "trade_confidence": <0-100>,
  "trader_statement": "My read in plain trading language: what the market is doing, why this entry has edge, what breaks the thesis, where I exit and why. Minimum 80 words — this is my professional reasoning on record.",
  "sl_structural_reference": "SL at [price] — behind [named level/structure]. Invalidated if [specific condition]. ~[X] pips.",
  "tp_structural_reference": "TP at [price] — [named zone/level and why it is the near edge]. ~[X] pips. R:R [X]:1.",
  "estimated_duration_minutes": "ATR-based estimate with arithmetic shown.",
  "edge_summary": "One to two sentences: the specific structural reason this entry has a probability advantage right now.",
  "confidence_anchor": "What I am most certain about, what stage the move is in, and my primary uncertainty.",
  "reasoning": {
    "thesis_why": "Why this direction is correct given the current structure and price location",
    "market_behavior": "What the market is doing and what it reveals about participant intent",
    "risk_acceptance": "Why SL placement is structurally sound and what specifically breaks it",
    "objective_alignment": "Whether this serves the session goal and at what quality level",
    "tp_path_audit": "Every named level, zone, or obstacle between entry and TP — including any I am accepting risk through",
    "session_phase": "Where we are in the session and what that means for follow-through",
    "range_position": "Where price sits in the ${controlTF} range and what that implies for direction probability"
  },
  "counter_thesis": "The single most credible structural reason this trade fails — named specifically, not generically.",
  "counter_thesis_probability": <0-100>,
  "entry_spec": { "entry_mode": "execute_now|wait_pullback|push_confirmation", "runawayPolicy": "RESCAN|EXECUTE_ON_FIRST_PULLBACK" },
  "thesis_coherence_statement": "My synthesis: I reconcile every answer_sheet field against my action. If any field shows a contradiction (e.g. Q8C=PREMIUM on a BUY, Q3=prior rejections at my entry level), I name it here and give the specific reason I am proceeding — or I output NO_TRADE. Q8C misalignment must always be acknowledged here even if I proceed.",${isScalp ? `
  "scalp_structural_confirmation": "Named M5 anchor — swing high/low, FVG, BOS, or EMA at specific price.",` : ''}${isMicro ? `
  "m15_structural_confirmation": "Named M15 anchor — swing, FVG, or BOS at specific price.",` : ''}${isIntraday ? `
  "h1_structural_confirmation": "Named H1 level and structure type.",` : ''}
  "trade_management": ${isScalp ? 'null,' : '{ "tp1_close_percent": <number>, "sl_to_breakeven_after_tp1": <bool>, "trail_method": "structure|fixed_pips|none", "trail_notes": "Named structural level I trail the runner behind." },'}
  "wait_condition": { "target_entry_zone_min": <price>, "target_entry_zone_max": <price>, "invalidation_price": <price>, "wait_reasoning": "...", "expected_wait_minutes": <your estimate, e.g. 15> },
WAIT_CONDITION RULE — MANDATORY when entry_mode is wait_pullback or push_confirmation:
  If entry_spec.entry_mode is "wait_pullback" or "push_confirmation", the wait_condition block is NOT optional.
  All four fields (target_entry_zone_min, target_entry_zone_max, invalidation_price, wait_reasoning) MUST be present with numeric prices.
  A response with entry_mode="wait_pullback" and no wait_condition block is a malformed response — output NO_TRADE instead.
  If entry_mode is "execute_now", omit wait_condition entirely.
ENTRY_MODE AND NO_TRADE — INCOMPATIBLE FIELDS:
  A NO_TRADE response must NOT include entry_mode, wait_condition, entry_spec, or any BUY/SELL execution fields.
  The NO_TRADE schema below is the only valid format when no trade is taken.
  "acceptable_profit_range": { "minUSD": <number>, "idealUSD": <number> },
  "answer_sheet": {
    "Q1_trend_alignment": "ALIGNED|CONFLICT|COUNTER_TREND",
    "Q2_structure_level": "Named level this trade anchors to — specific price",
    "Q3_prior_rejections": "YES — [count] at [price] | NO",
    "Q4_momentum_stage": "FRESH|DEVELOPING|EXHAUSTED — named structure evidence",
    "Q5_failure_mode": "Most likely specific structural failure — not a generic phrase",
    "Q5_failure_probability": <0-100>,
    "Q5B_objective_alignment": "SERVES|MARGINAL|DOES_NOT_SERVE",
    "Q6_entry_trigger": "Named observable event that already fired | NONE_YET",
    "Q7_confluence_confirmed": "X/7 — each of the 7 dimensions with its specific confirming data point or ABSENT",
    "Q7_confluence_judgment": "How many dimensions confirmed, what that means for my confidence, and my net judgment.",
    "Q8_move_position_pct": <0-100>,
    "Q8B_session_range_pct": <0-100>,
    "Q8C_price_location_zone": "DISCOUNT|EQUILIBRIUM|PREMIUM",
    "Q8D_weekly_narrative": "DELIVERY_BULLISH|DELIVERY_BEARISH|REBALANCING|UNCERTAIN",
    "kill_zone": "LONDON_OPEN|NY_OPEN|NY_PM|PRE_KILL_ZONE|OUTSIDE_KILL_ZONE",
    "news_status": "HARD_BLACKOUT|POST_NEWS_VOLATILITY|TIER2_PROXIMITY|CLEAR|UNKNOWN",
    "equal_highs_lows": "Unswept pools within range — specific prices | NONE",
    "trap_signature": "NONE | trap type and which side is trapped",
    "failed_auction": "NONE | type and confirmation candle status",
    "intermarket_correlation": "CONFLUENT|DIVERGENT|UNKNOWN",
    "Q9_sl_wick_proximity": "CLEAR — nearest wick at [price] is [X] pips from SL | PROXIMITY_RISK — [assessment]"
  }
}

NO_TRADE:
{
  "action": "NO_TRADE",
  "trade_confidence": <0-100>,
  "reasoning": { "thesis_why": "Specific reason no trade exists — structural, not absence of perfection" },
  "block_reason": "One of: ${ALPHA_IDENTITY.LEGITIMATE_BLOCK_CONDITIONS.join(' | ')} | NO_EDGE"
}`;

  const professionalReasoningProcess = `HOW I THINK BEFORE EVERY DECISION:

Before I look at a single candle, I orient myself. I am a professional putting real capital at risk. My job is not to find a trade — it is to find a trade worth taking. Those are different things.

1. LOCATION FIRST — Where is price right now in the ${controlTF} range?
   If price is at the top of a range (PREMIUM), I am leaning toward sells or staying flat. If price is at the bottom (DISCOUNT), I am leaning toward buys or staying flat. Location is a probability weight — it shifts my prior, it does not veto a direction. If I am trading against location, I acknowledge it in Q8C and thesis_coherence_statement, name what else is in my favor, and proceed. Strong confluence from other dimensions can outweigh an unfavorable location — I am weighing evidence, not following a rule.

2. STRUCTURE NEXT — What is the ${controlTF} actually doing?
   I name the structure. Uptrend with higher highs and higher lows. Distribution with price capped at a ceiling. Range with defined boundaries. If the ${controlTF} structure conflicts with my intended direction, I need to understand why I am trading against it before I proceed — or I step aside.

3. IS THERE CLEAN AIR TO MY TARGET?
   I trace the path from entry to TP and name every obstacle. A prior rejection level sitting between entry and TP is not something I "hope" price breaks through — it is a real barrier that reduces the probability of a full runner. If the path is blocked, I either move TP to the near side of the obstacle or I do not take the trade.

4. WHAT HAPPENED THE LAST TIME PRICE WAS HERE?
   Prior rejections are not just trivia — they are evidence of participant behavior. If price was rejected at a level twice before, a third attempt carries real failure risk. I need a specific reason the third attempt is different (swept highs/lows above/below, structural break above, trapped liquidity cleared) or I treat it as a fading opportunity, not a breakout.

5. WHAT IS THE MOVE STAGE?
   I do not buy the top of a 5-candle impulse. I do not sell the bottom of a 5-candle impulse. If the move is EXHAUSTED on the ${confirmationTF}, I need a reversal thesis, not a continuation thesis. Fresh moves have follow-through. Late-stage moves need mean reversion logic.

6. WHAT BREAKS THIS TRADE?
   Every trade has a specific failure mode. I name it and give it a probability. I then state clearly whether I believe the edge still holds — and I continue trading unless I genuinely cannot identify a probability advantage. The failure case is a transparency checkpoint, not a veto. If I cannot name a specific structural reason the trade has edge despite the failure risk, I step aside. If I can, I proceed and log my reasoning.

7. COHERENCE CHECK — Do all my answers agree?
   My answer_sheet is an audit trail. If Q8C says PREMIUM and my action is BUY, I must name exactly why that premium zone has a reversal or continuation catalyst that overrides the location logic. If Q3 shows prior rejections at my entry and I am still buying, I must name what cleared those rejections. If I notice a contradiction in my answer_sheet, I do not auto-eject — I complete the resolution in thesis_coherence_statement, name the conflict explicitly, and then decide. A trade is only NO_TRADE if I genuinely cannot construct a named structural resolution to the conflict after trying. Incomplete reasoning is a reason to complete my thinking, not a reason to abort.

TIMING STACK: primary=${primaryTF} | control=${controlTF} | confirmation=${confirmationTF}

Q1 TREND: What is the ${controlTF} structure? Name it.
Q2 PATH: Trace entry to TP. Name every level and obstacle in the path.
Q3 PRIOR REJECTIONS: Has price been here before? What happened and what is different now?
Q4 MOMENTUM: What stage is the move? What does ${confirmationTF} show?
Q5 DEVIL'S ADVOCATE: What is the most credible structural reason this fails? What is the probability? I state clearly whether the edge still holds despite this risk and why — then I proceed. This question is a transparency checkpoint, not a veto. I always answer it. I only step aside if I genuinely cannot identify a structural reason the edge holds.
Q5B OBJECTIVE: Does this serve the session goal at an acceptable quality level?
Q6 TRIGGER: What specific observable event already fired that confirms entry? Proximity is not a trigger.
Q7 CONFLUENCE: TREND | STRUCTURE | MOMENTUM | TIMING | LIQUIDITY | PATTERN | OMEGA_CONSENSUS — each dimension named specifically with confirming evidence or marked ABSENT. Count standard: 3/7 with a named trigger is a valid trade. 4/7 is solid. 5+/7 is excellent. I do not require all 7 — I require honest accounting of what is confirmed. I state the count and what it means for my confidence level.
Q8 RANGE: How far into the move am I? Where in session range?
Q8C LOCATION: DISCOUNT / EQUILIBRIUM / PREMIUM in the ${controlTF} range. I state the current location and whether it aligns with my trade direction. If it does not align, I acknowledge it explicitly and continue — the mismatch is logged for audit. Location is a factor I weigh, not a gate I must pass.
Q8D WEEKLY: Does the weekly delivery narrative support direction?
Q9 SL WICKS: Are there wicks near my SL on the ${primaryTF}? A stop inside a wick cluster gets swept.${isMicro || isIntraday ? `
Q10 MANAGEMENT: TP1 percentage, breakeven trigger, trail method, structural level to trail behind.` : ''}`;

  return `I am Alpha — a professional intraday trader. I think like one, not like a system executing rules.
STYLE: ${style} | PRIMARY: ${primaryTF} | CONTROL: ${controlTF} | CONFIRMATION: ${confirmationTF}

I receive: candles, EMA stack, ATR, Omega sensor observations, regime context, adversarial signals, liquidity data, session context, and performance history. I read everything and I decide.

Advisory systems (Regime Oracle, Adversarial Detector, Omega Council, Session Context) give me market context. They inform my thinking. They do not override my judgment.

${arenaWalls}

${professionalReasoningProcess}

${auditSchema}`;
}

