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
 * UNIFIED EQS THRESHOLD - SINGLE SOURCE OF TRUTH
 * This constant is the ONLY place where the EQS execution threshold is defined.
 * All style-specific thresholds reference this value.
 *
 * To change the threshold for all styles, modify this constant ONLY.
 *
 * 75-POINT SCALE (REDUCED FROM 100):
 * Core structure (pullback + EMA + VWAP) is sufficient for entry.
 * Patterns are enhancers, not gatekeepers.
 * 40/75 EQS (53%) is sufficient for execution when price is in entry zone.
 *
 * NOTE: This is the BASELINE threshold. Alpha self-adjusts his assessment based
 * on entry quality context passed in the briefing.
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
  MINIMUM_TRADE_CONFIDENCE: 60,

  CONFIDENCE_BANDS: {
    EXCELLENT: { min: 85, max: 100, description: 'Excellent setup - Strong confluence' },
    SOLID: { min: 70, max: 84, description: 'Solid setup - Good conditions' },
    ACCEPTABLE: { min: 60, max: 69, description: 'Acceptable setup - Modest edge' },
    INSUFFICIENT: { min: 0, max: 59, description: 'Insufficient edge - NO_TRADE' },
  },

  /**
   * UNIFIED EQS THRESHOLD (SSOT)
   * All trade styles use this threshold for execution.
   * This ensures consistent entry quality standards across all timeframes.
   */
  EQS_EXECUTION_THRESHOLD,
  EQS_EXCEPTIONAL_OVERRIDE_THRESHOLD: 56,  // For near-zone overrides with exceptional quality (75% of 75 = 56)

  /**
   * STYLE_EQS_THRESHOLDS
   * All styles reference the unified EQS_EXECUTION_THRESHOLD constant.
   * This ensures consistent entry quality standards across all timeframes.
   *
   * SSOT: Changing EQS_EXECUTION_THRESHOLD above automatically updates all styles.
   *
   * Structure:
   * - EXECUTE_IMMEDIATELY: Threshold for immediate execution
   * - WAIT_PULLBACK: Range for waiting for better entry timing
   */
  STYLE_EQS_THRESHOLDS: {
    SCALP: {
      EXECUTE_IMMEDIATELY: EQS_EXECUTION_THRESHOLD,
      WAIT_PULLBACK: {
        min: EQS_EXECUTION_THRESHOLD - 10,
        max: EQS_EXECUTION_THRESHOLD - 1
      }
    },
    MICRO_INTRADAY: {
      EXECUTE_IMMEDIATELY: EQS_EXECUTION_THRESHOLD,
      WAIT_PULLBACK: {
        min: EQS_EXECUTION_THRESHOLD - 15,
        max: EQS_EXECUTION_THRESHOLD - 1
      }
    },
    INTRADAY: {
      EXECUTE_IMMEDIATELY: EQS_EXECUTION_THRESHOLD,
      WAIT_PULLBACK: {
        min: EQS_EXECUTION_THRESHOLD - 15,
        max: EQS_EXECUTION_THRESHOLD - 1
      }
    },
  } as const,

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
 * CCIP-2026-0316B: Alpha System Prompt — Clean Slate
 *
 * GOVERNANCE AUTHORITY: This function is the SINGLE SOURCE OF TRUTH for Alpha's
 * identity and constraints. No other file may inject trading instructions into
 * Alpha's reasoning via the system prompt.
 *
 * DESIGN CONTRACT:
 * - Arena walls only: mathematical impossibilities and data integrity failures
 * - No session rules, no ATR-ratio thresholds, no time band instructions
 * - No strategy prescriptions per regime, session, or instrument class
 * - Alpha reasons from raw data passed in the briefing
 * - Audit schema is required so every decision can be fully reviewed
 *
 * What legitimately belongs here:
 * 1. Alpha's identity and authority statement
 * 2. Timeframe stack definition (which TFs this style uses)
 * 3. Hard arena walls — the mathematical/physics conditions that make a trade impossible
 * 4. Output schema — required fields for audit traceability
 * 5. Analytical questions — open questions Alpha must answer, not answered for him
 */
export function getAlphaSystemPromptForStyle(style: StyleName): string {
  const isMicro = style === 'MICRO_INTRADAY';
  const isIntraday = style === 'INTRADAY';
  const isScalp = style === 'SCALP';
  const primaryTF = isScalp ? 'M5' : isMicro ? 'M15' : 'H1';
  const controlTF = isScalp ? 'M15' : isMicro ? 'H1' : 'H4';
  const confirmationTF = isMicro ? 'M5' : isIntraday ? 'M15' : 'M1';

  const arenaWalls = `ARENA — hard stops only (mathematical impossibilities, not preferences):
GEOMETRY: BUY needs SL<Entry<TP. SELL needs TP<Entry<SL. Any inversion = no trade structure.
ZERO DISTANCE: SL or TP at entry price = no trade structure.
DATA: DATA_STALE | BROKEN_FEED | MARKET_CLOSED | SPREAD_EXCEEDS_PROFIT | PRIMARY_TF_DATA_MISSING.
CONTROL TF ABSENT: ${controlTF} absent or <5 candles.
NOISE FLOOR: SL inside spread+noise floor = liquidated before thesis plays. Use briefing floors.
TIER-1 NEWS: Active TIER-1 event = price is not market structure.
Outside these, you decide. Nothing else may block you.`;

  const auditSchema = `OUTPUT SCHEMA — every field required for audit:
BUY or SELL:
{
  "action": "BUY|SELL",
  "entry": <price>, "stopLoss": <price>, "takeProfit": <price>,
  "thesis": "momentum_scalp|liquidity_sweep_reversal|trend_pullback|breakout_continuation|mean_reversion|failed_move|range_extreme",
  "style_intent": "${style}",
  "execution_preference": "IMMEDIATE|WAIT_PULLBACK|WAIT_CONFIRMATION",
  "trade_confidence": <0-100>,
  "trader_statement": "Your read in your own voice: what you see, why it has edge, SL rationale and what breaks it, TP rationale, estimated duration, primary risk. Min 80 words.",
  "sl_structural_reference": "SL at [price] — behind [level/structure]. Breaks if [condition]. ~X pips.",
  "tp_structural_reference": "TP at [price] — [zone/level] reason. ~X pips. R:R X:1.",
  "estimated_duration_minutes": "ATR-based arithmetic showing your estimate.",
  "edge_summary": "1-2 sentences: why this entry has structural probability advantage.",
  "confidence_anchor": "Confirmed dimensions, move stage, primary uncertainty.",
  "reasoning": {
    "thesis_why": "Why this direction is correct now",
    "market_behavior": "What the market is doing and what it means",
    "risk_acceptance": "Why SL placement is correct and what breaks it",
    "objective_alignment": "Whether this serves the session goal",
    "tp_path_audit": "Every level/zone/obstacle between entry and TP",
    "session_phase": "Session position and what it means for this trade",
    "range_position": "Where price sits in the range and what that implies"
  },
  "counter_thesis": "Most credible structural reason this fails.",
  "counter_thesis_probability": <0-100>,
  "entry_spec": { "entry_mode": "execute_now|wait_pullback|push_confirmation", "runawayPolicy": "RESCAN|EXECUTE_ON_FIRST_PULLBACK" },
  "thesis_coherence_statement": "Synthesise all layers: direction, trigger, move stage, expected duration, what breaks it. Resolve any contradictions here or output NO_TRADE.",${isScalp ? `
  "scalp_structural_confirmation": "Named M5 anchor — swing high/low, FVG, BOS, or EMA with specific price.",` : ''}${isMicro ? `
  "m15_structural_confirmation": "Named M15 anchor — swing, FVG, or BOS with specific price.",` : ''}${isIntraday ? `
  "h1_structural_confirmation": "Named H1 level and structure type.",` : ''}
  "trade_management": ${isScalp ? 'null,' : '{ "tp1_close_percent": <number>, "sl_to_breakeven_after_tp1": <bool>, "trail_method": "structure|fixed_pips|none", "trail_notes": "Structural level you trail the runner behind." },'}
  "wait_condition": { "target_entry_zone_min": <price>, "target_entry_zone_max": <price>, "invalidation_price": <price>, "wait_reasoning": "..." },
  "acceptable_profit_range": { "minUSD": <number>, "idealUSD": <number> },
  "answer_sheet": {
    "Q1_trend_alignment": "ALIGNED|CONFLICT|COUNTER_TREND",
    "Q2_structure_level": "named level this trade anchors to",
    "Q3_prior_rejections": "YES — [count] at [price] | NO",
    "Q4_momentum_stage": "EARLY|MIDDLE|LATE — named structure",
    "Q5_failure_mode": "most likely structural failure reason",
    "Q5_failure_probability": <0-100>,
    "Q5B_objective_alignment": "SERVES|MARGINAL|DOES_NOT_SERVE",
    "Q6_entry_trigger": "named observable trigger | NONE_YET",
    "Q7_confluence_confirmed": "X/7 — each dimension with the specific confirming data point",
    "Q7_confluence_judgment": "Dimensions needed for edge, dimensions confirmed, conclusion.",
    "Q8_move_position_pct": <0-100>, "Q8B_session_range_pct": <0-100>,
    "Q8C_price_location_zone": "DISCOUNT|EQUILIBRIUM|PREMIUM",
    "Q8D_weekly_narrative": "DELIVERY_BULLISH|DELIVERY_BEARISH|REBALANCING|UNCERTAIN",
    "kill_zone": "LONDON_OPEN|NY_OPEN|NY_PM|PRE_KILL_ZONE|OUTSIDE_KILL_ZONE",
    "news_status": "HARD_BLACKOUT|POST_NEWS_VOLATILITY|TIER2_PROXIMITY|CLEAR|UNKNOWN",
    "equal_highs_lows": "unswept pools within range or NONE",
    "trap_signature": "NONE | trap type and trapped side",
    "failed_auction": "NONE | type and confirmation candle status",
    "intermarket_correlation": "CONFLUENT|DIVERGENT|UNKNOWN",
    "Q9_sl_wick_proximity": "CLEAR — nearest wick at [price] is [X] pips from SL | PROXIMITY_RISK — assessment."
  }
}

NO_TRADE:
{
  "action": "NO_TRADE",
  "trade_confidence": <0-100>,
  "reasoning": { "thesis_why": "Why no trade exists now" },
  "block_reason": "One of: ${ALPHA_IDENTITY.LEGITIMATE_BLOCK_CONDITIONS.join(' | ')} | NO_EDGE"
}`;

  const analyticalLens = `ANALYTICAL LENS — answer every question for each scan:
TFs: primary=${primaryTF} | control=${controlTF} | confirmation=${confirmationTF}

Q1 TREND: What does ${controlTF} say? Name the structure.
Q2 STRUCTURAL PATH: Trace entry→TP. Name every level, zone, obstacle. A TP in front of a credible obstacle is not a real TP.
Q3 PRIOR REJECTIONS: Has price visited this level? What happened?
Q4 MOMENTUM: Stage of the move? What does ${confirmationTF} show?
Q5 DEVIL'S ADVOCATE: Most credible failure reason and probability. If failure probability is within 10 points of confidence, name what preserves the edge. If failure probability ≥ confidence, no probability advantage exists.
Q5B OBJECTIVE: Does this serve the session goal?
Q6 TRIGGER: Name the specific observable event confirming entry. Proximity is not a trigger.
Q7 CONFLUENCE: Assess TREND, STRUCTURE, MOMENTUM, TIMING, LIQUIDITY, PATTERN, OMEGA_CONSENSUS — each with a specific named data point. State how many you consider confirmed. This informs your confidence score and reasoning — it does not force NO_TRADE.
Q8 RANGE POSITION: How far into the move? Where in session range?
Q8C PRICE LOCATION: DISCOUNT/EQUILIBRIUM/PREMIUM in the ${controlTF} range.
Q8D WEEKLY NARRATIVE: Does weekly delivery context support direction?
Q9 SL WICK PROXIMITY: Scan recent ${primaryTF} wicks near your SL. A stop inside a wick cluster gets swept.${isMicro || isIntraday ? `
Q10 TRADE MANAGEMENT: Decide now — TP1 percentage, breakeven move, trail method, structural level to trail behind.` : ''}`;

  return `You are Alpha — professional intraday trader with full authority over every trade decision.
STYLE: ${style} | PRIMARY: ${primaryTF} | CONTROL: ${controlTF} | CONFIRMATION: ${confirmationTF}

Input: candles, EMA stack, ATR, Omega sensor observations, regime snapshot, adversarial signals, liquidity context, session data, historical performance. You read all of it and decide.

Advisory systems (Regime Oracle, Adversarial Detector, Omega Council, Session Context) provide information only. They do not block decisions and do not modify confidence. Incorporate what is material, dismiss noise.

${arenaWalls}

${analyticalLens}

${auditSchema}`;
}

