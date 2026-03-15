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
 * NOTE: This is the BASELINE threshold. High confidence can relax this further.
 * See getConfidenceAdjustedEQSThreshold() for dynamic adjustment logic.
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
 * DEPRECATED: Old confidence-based EQS threshold adjustment
 * Kept for backward compatibility during migration
 */
export const EQS_CONFIDENCE_TIERS = {
  EXCELLENT: { minConfidence: 85, eqsAdjustment: -10 },  // 85%+ confidence: EQS 30
  SOLID: { minConfidence: 70, eqsAdjustment: -5 },       // 70%+ confidence: EQS 35
  ACCEPTABLE: { minConfidence: 60, eqsAdjustment: 0 },   // 60%+ confidence: EQS 40
} as const;

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
 * VOLATILITY_REGIME_THRESHOLDS — SSOT for volatility context classification
 *
 * CCIP GOVERNANCE (CCIP-2026-0224A):
 * These thresholds define the ATR-ratio bands Alpha must reason about before
 * committing to an entry. They are passed to Alpha as named context and embedded
 * in the system prompt as a named diagnostic check.
 *
 * NORMAL BAND: 80-120% of 20-period ATR average (0.80–1.20 ratio)
 * COMPRESSION: below 80% — breakout entries carry false-breakout risk
 * EXPANSION:   above 120% — SL distances must account for elevated noise
 * SPIKE:       above 200% — news-driven volatility, wait for structure to form
 *
 * AUTHORITY: This constant is the ONLY definition of ATR-ratio volatility bands.
 * The ATR math in src/lib/technical-math/atr.ts uses 0.7/1.5 thresholds for its
 * own COMPRESSION/NORMAL/EXPANSION enum (inherited legacy). The thresholds here
 * are the governance-layer thresholds used by the Alpha prompt and advisory
 * systems. They are intentionally tighter (0.80/1.20) to give Alpha earlier
 * warning before the ATR library would classify the regime as extreme.
 */
export const VOLATILITY_REGIME_THRESHOLDS = {
  NORMAL_BAND_LOW: 0.80,
  NORMAL_BAND_HIGH: 1.20,
  SPIKE_THRESHOLD: 2.00,
  COMPRESSION_MAX_ATR_RATIO: 0.80,
  EXPANSION_MIN_ATR_RATIO: 1.20,
} as const;

/**
 * SCALP_TIME_CONTRACT — SSOT for scalp behavioral time reference thresholds
 *
 * CCIP GOVERNANCE (CCIP-2026-0224A, updated CCIP-2026-0225A, revised CCIP-2026-0310A,
 * revised CCIP-2026-0313A):
 *
 * A scalp is defined by behavior: a sharp, direct move to TP with minimal stalling.
 * These thresholds are ADVISORY REFERENCES passed to Alpha as reasoning context.
 * They are NOT hard blocks. Alpha has final authority.
 *
 * Alpha MUST estimate velocity arithmetic and state it. If the estimated time exceeds
 * ABSOLUTE_MAX_MIN, Alpha must acknowledge the style mismatch and either:
 *   (a) provide explicit reasoning why the trade still qualifies for this style, or
 *   (b) output NO_TRADE as his own reasoned conclusion.
 *
 * The system does NOT block on time estimates. Alpha self-governs.
 *
 * EXPECTED_DURATION_MAX_MIN: Clean scalp reference ceiling — under this is clearly scalp
 * ABSOLUTE_MAX_MIN: Reference upper bound — above this is MICRO_INTRADAY profile
 * STRAIGHT_RUN_REQUIRED: A scalp must run directly to TP. Stalling = MICRO_INTRADAY profile.
 * STYLE_VIOLATION_REASON: Kept for backward compatibility — no longer a legitimate block condition.
 *   Alpha uses this as an advisory label in his reasoning only.
 */
export const SCALP_TIME_CONTRACT = {
  EXPECTED_DURATION_MIN_MIN: 15,
  EXPECTED_DURATION_MAX_MIN: 60,
  ABSOLUTE_MAX_MIN: 90,
  STRAIGHT_RUN_REQUIRED: true,
  STYLE_VIOLATION_REASON: 'STYLE_TIME_VIOLATION' as const,
} as const;

/**
 * CONFLUENCE_REQUIREMENTS — SSOT for reference confluence thresholds by trade style
 *
 * CCIP-2026-0219B: Lowered MICRO_INTRADAY and INTRADAY from 4/5 to 3/5.
 * CCIP-2026-0310A: Converted from hard auto-block to Alpha reasoning reference.
 *   Alpha receives these thresholds as context and must reason about confluence.
 *   Alpha self-governs: if he cannot construct an edge argument with the confluence
 *   available, he outputs NO_TRADE of his own reasoned judgment.
 *
 * The 5 core independent dimensions are:
 *   1. TREND      — EMA stack alignment, HTF trend direction
 *   2. STRUCTURE  — BOS/CHOCH confirmation, S/R level holding or breaking
 *   3. MOMENTUM   — RSI position, MACD, consecutive candle direction
 *   4. TIMING     — EQS score, pullback completion, M1 confirmation
 *   5. LIQUIDITY  — Liquidity sweep completion, pool position, VWAP interaction
 *
 * PATTERN and OMEGA CONSENSUS are supplementary dimensions — they increase
 * confidence when present but do NOT count toward the minimum floor.
 *
 * AUTHORITY: This constant is the ONLY place that defines reference confluence floors.
 * The Alpha prompt (getAlphaSystemPromptForStyle) reads from this value.
 * No other file may hardcode a confluence floor.
 */
export const CONFLUENCE_REQUIREMENTS = {
  SCALP: {
    MIN_DIMENSIONS: 2,
    TOTAL_CORE_DIMENSIONS: 5,
    CONFIDENCE_CEILING_AT_MIN: 100,
  },
  MICRO_INTRADAY: {
    MIN_DIMENSIONS: 3,
    TOTAL_CORE_DIMENSIONS: 5,
    CONFIDENCE_CEILING_AT_MIN: 100,
  },
  INTRADAY: {
    MIN_DIMENSIONS: 3,
    TOTAL_CORE_DIMENSIONS: 5,
    CONFIDENCE_CEILING_AT_MIN: 100,
  },
  BELOW_MINIMUM_ACTION: 'NO_TRADE' as const,
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
  ] as const,

  ADVISORY_SYSTEMS: {
    REGIME_ORACLE: {
      name: 'Regime Oracle',
      type: 'ADVISORY' as const,
      maxConfidencePenalty: 15,
      canBlock: false,
    },
    ADVERSARIAL_DETECTOR: {
      name: 'Adversarial Detector',
      type: 'ADVISORY' as const,
      maxConfidencePenalty: 0,
      canBlock: false,
      mode: 'INFORM_ONLY' as const,
    },
    SESSION_CONSTRAINTS: {
      name: 'Session Constraints',
      type: 'ADVISORY' as const,
      maxConfidencePenalty: 10,
      canBlock: false,
    },
    OMEGA_CONSENSUS: {
      name: 'Omega Consensus',
      type: 'ADVISORY' as const,
      maxConfidencePenalty: 0,
      canBlock: false,
    },
  },

  /**
   * CCIP-2026-0310-OMEGA: Omega consensus carries ZERO advisory penalty.
   *
   * Omega brains provide raw sensor observations to Alpha. Alpha's confidence
   * output already incorporates everything he has reasoned about — including
   * the Omega briefing. Applying a code-level penalty on top of Alpha's stated
   * confidence is double-counting: it distorts his output without giving him
   * any new information to reason differently.
   *
   * The MAX_ADVISORY_PENALTY (10) applies only to Regime Oracle and Adversarial
   * Detector — systems that detect environmental conditions outside Alpha's
   * direct candle-reading (session phase, manipulation patterns). Omega is a
   * price-structure reader like Alpha — his disagreement is data for Alpha's
   * reasoning, not a post-hoc penalty on Alpha's conclusion.
   *
   * SSOT: This value is the single authority for all advisory penalty caps.
   * coordinator-alpha.ts and pipnosis-core-rules.ts both reference this constant.
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

/**
 * DEPRECATED: Get confidence-adjusted EQS threshold
 * Old approach: Adjusted EQS threshold based on confidence
 * New approach: Adjust confidence based on EQS, then compare to fixed threshold
 *
 * Kept for backward compatibility during migration.
 */
export function getConfidenceAdjustedEQSThreshold(tradeConfidence: number): number {
  if (tradeConfidence >= EQS_CONFIDENCE_TIERS.EXCELLENT.minConfidence) {
    return ALPHA_IDENTITY.EQS_EXECUTION_THRESHOLD + EQS_CONFIDENCE_TIERS.EXCELLENT.eqsAdjustment;
  }
  if (tradeConfidence >= EQS_CONFIDENCE_TIERS.SOLID.minConfidence) {
    return ALPHA_IDENTITY.EQS_EXECUTION_THRESHOLD + EQS_CONFIDENCE_TIERS.SOLID.eqsAdjustment;
  }
  return ALPHA_IDENTITY.EQS_EXECUTION_THRESHOLD;
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

export function calculateAdvisoryPenalty(
  advisoryPenalties: { source: string; penalty: number }[]
): number {
  const totalPenalty = advisoryPenalties.reduce((sum, a) => sum + a.penalty, 0);
  return Math.min(totalPenalty, ALPHA_IDENTITY.MAX_ADVISORY_PENALTY);
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
export function getAlphaSystemPromptForStyle(style: StyleName): string {
  const isMicro = style === 'MICRO_INTRADAY';
  const isIntraday = style === 'INTRADAY';
  const isScalp = style === 'SCALP';
  const primaryTF = isScalp ? 'M5' : isMicro ? 'M15' : 'H1';
  const controlTF = isScalp ? 'M15' : isMicro ? 'H1' : 'H4';
  const lowerTF = isMicro ? 'M5' : isIntraday ? 'M15' : 'M1';
  const rrRange = isMicro ? '1.0–2.0' : isIntraday ? '1.0–3.0' : '1.0–1.5';
  const newsBlackoutPre = isScalp ? '15' : isMicro ? '30' : '60';
  const newsBlackoutPost = isScalp ? '15' : isMicro ? '20' : '30';
  const tier2Window = isScalp ? '20' : isMicro ? '45' : '90';

  const validStructures = isScalp
    ? `SCALP STRUCTURES (one must match or return NO_TRADE with NO_NAMED_STRUCTURE):
MOMENTUM_BREAKOUT | BOS_RETEST | EMA_REJECTION | DOUBLE_BOTTOM | DOUBLE_TOP | RANGE_BREAKOUT | LIQUIDITY_SWEEP | ENGULFING_AT_STRUCTURE | TREND_PULLBACK_EMA`
    : isMicro
    ? `MICRO_INTRADAY STRUCTURES (one must match or return NO_TRADE with NO_NAMED_STRUCTURE):
OB_RETEST | FVG_ENTRY | BOS_CONTINUATION | EMA_PULLBACK | SWEEP_REVERSAL | D1_LEVEL_REACTION | H1_RANGE_EXTREME`
    : `INTRADAY STRUCTURES (one must match or return NO_TRADE with NO_NAMED_STRUCTURE):
H1_OB_RETEST | H1_FVG_FILL | H1_BOS_CONTINUATION | H1_CAMPAIGN_PULLBACK | H4_LEVEL_REACTION | WEEKLY_LEVEL_REVERSAL`;

  const confluenceRule = isScalp
    ? `CONFLUENCE — 5 core dimensions: TREND, STRUCTURE, MOMENTUM, TIMING, LIQUIDITY. Min 2 confirmed. 0 confirmed = NO_TRADE. PATTERN and OMEGA are supplementary only.`
    : `CONFLUENCE — 5 core dimensions: TREND, STRUCTURE, MOMENTUM, TIMING, LIQUIDITY. Min 3 confirmed including TREND and STRUCTURE. Without TREND or STRUCTURE: confidence ceiling 65%. Below 3 = NO_TRADE. Counter-trend: reference floor 4/5 recommended — Alpha reasons on this, it is not a hard gate. PATTERN and OMEGA are supplementary only.`;

  const sessionRules = isScalp
    ? `DEAD ZONE (22:00–00:00 UTC): Acknowledge. Honest confidence must reflect reduced liquidity and narrow M5 legs (10-20 pips). Your stated confidence is the decision — no system penalty added.
ASIAN SESSION (00:00–07:00 UTC): XAUUSD/JPY/crypto — active, normal evaluation. EURUSD/GBPUSD — range risk elevated, state range position. Do NOT block Asian-primary instruments for clock time alone.`
    : isMicro
    ? `DEAD ZONE (22:00–00:00 UTC): State expected trade maturation window. Honest confidence reflects current liquidity. EXECUTE_NOW or NO_TRADE — not WAIT_PULLBACK for session alone.
ASIAN SESSION: State instrument type (Asian-primary vs London-primary). Confidence reflects session liquidity reality.`
    : `DEAD ZONE (22:00–00:00 UTC): Mild constraint — INTRADAY trades extend well past it. Honest confidence reflects all sessions the trade runs through.
ASIAN SESSION: Not a meaningful constraint. Trade will mature through London/NY.`;

  const styleTimeContract = isScalp
    ? `VELOCITY ASSESSMENT (mandatory — complete before structural analysis):
Arithmetic: TP distance ÷ M5 ATR = estimated candles × 5 = estimated minutes.
SUFFICIENT: ≤ ${SCALP_TIME_CONTRACT.EXPECTED_DURATION_MAX_MIN} min, direct path — clearly a scalp profile.
BORDERLINE: ${SCALP_TIME_CONTRACT.EXPECTED_DURATION_MAX_MIN}–${SCALP_TIME_CONTRACT.ABSOLUTE_MAX_MIN} min — valid if: (a) active momentum not consolidation, (b) M5 ATR at/above session avg, (c) no structural obstacles to TP.
EXTENDED: > ${SCALP_TIME_CONTRACT.ABSOLUTE_MAX_MIN} min — this is a MICRO_INTRADAY profile, not a scalp. You must address this directly: state the estimated time, acknowledge the style mismatch, and explain why you believe this trade still qualifies for this session's style. If your reasoning does not hold up, NO_TRADE is the correct conclusion — this is your judgment, not a system block.
State always: "M5 ATR: X pips. TP distance: Y pips. Estimated candles: Z. Estimated minutes: T. Velocity: SUFFICIENT/BORDERLINE/EXTENDED. [If EXTENDED: style reasoning below.]"`
    : isMicro
    ? `TIME CONTRACT: 1–6 hours. ${primaryTF} primary. ${controlTF} validation required.`
    : `TIME CONTRACT: 2–10 hours. ${primaryTF} primary. ${controlTF} validation required.`;

  const moveStageRule = isScalp
    ? `MOVE STAGE: FRESH (<0.75x ATR) = full confidence. DEVELOPING (0.75–1.5x ATR) = pullback entry preferred. EXHAUSTED (>1.5x ATR) = state it explicitly and justify continuation or output NO_TRADE as your own conclusion.
SUB-MODE: MOMENTUM_CONTINUATION (fresh move) | PULLBACK_ENTRY (retrace in progress — wait_pullback until completion) | CONSOLIDATION_BREAKOUT (wait for body close outside range). State sub-mode in reasoning.
COUNTER-TREND ADVISORY: Counter-trend trades are valid setups. State your counter-trend basis: sweep-and-reclaim / double formation with neck break / full MSS (CHOCH + BOS both confirmed on closed candles). Reference floor: 4/5 confluence recommended for counter-trend. If basis is not yet confirmed, state that clearly — wait_pullback or NO_TRADE is your own reasoned decision, not a system gate.`
    : `MOVE STAGE: FRESH (<0.75x ATR) = full confidence. DEVELOPING (0.75–1.5x) = pullback preferred. EXHAUSTED (>1.5x) = state explicitly, recalculate R:R from current price, justify continuation or NO_TRADE.
LATE STAGE: Recalculate R:R from current price. If insufficient, NO_TRADE is the correct conclusion — not wait_pullback. wait_pullback is a confident trade with timing preference, not a chase on an exhausted leg.
COUNTER-TREND ADVISORY: Counter-trend trades are valid setups. State your counter-trend basis: sweep-and-reclaim / double formation with neck break / full MSS (CHOCH + BOS both confirmed). Reference floor: 4/5 confluence recommended for counter-trend. Alpha reasons and decides — no system gate blocks counter-trend entries.`;

  const hardBlocks = `HARD BLOCKS — immediate NO_TRADE regardless of reasoning:
A. GEOMETRY: BUY requires SL < Entry < TP. SELL requires TP < Entry < SL. Any inversion = reject.
B. ZERO DISTANCE: SL or TP at entry price.
C. DATA: DATA_STALE | BROKEN_FEED | MARKET_CLOSED | SPREAD_EXCEEDS_PROFIT | PRIMARY_TF_DATA_MISSING.
D. MTF_DATA_MISSING: ${controlTF} candle data absent or <5 candles.
E. NOISE FLOOR: SL closer to entry than the constraint noise floor = NO_TRADE.
F. SPREAD: Account for spread on SL distance. State: "Effective SL distance after spread: Y pips. R:R after spread: Z."
G. NEWS BLACKOUT (TIER-1 within ${newsBlackoutPre} min pre or ${newsBlackoutPost} min post): NO_TRADE with NEWS_BLACKOUT or POST_NEWS_VOLATILITY.

EXHAUSTED MOVE ADVISORY (not a hard block): If price has moved >1.5x ATR from last swing, state this explicitly. A professional trader recognizes exhausted momentum. If entering against exhaustion, you must justify: explicit continuation catalyst, fresh liquidity sweep, or structural reset. If you cannot justify continuation, NO_TRADE is your own reasoned conclusion — not a system block.`;

  const arenaWalls = `ARENA WALLS — your constraint block defines the structural survival floor for this instrument at this price:
FOREX: SL floor ~0.05% of price. Below this, spread consumes SL before price moves.
CRYPTO: SL floor 0.30–0.50% of price minimum. Crypto moves this in seconds.
METAL (XAUUSD): SL floor ~0.20% of price. Gold absorbs tight stops before reversing.
INDEX (US30/NAS100): Price-tier-scaled. Read the wall in your constraints — do not assume from memory.
WALL AUTHORITY: These floors are reference context. Apply your own structural reasoning — the wall informs your SL placement, it does not override your judgment.`;

  const rRRule = `R:R ACCOUNTABILITY: Place SL and TP at structural levels always. If resulting R:R < 1.0:1, state it explicitly and justify why the win rate threshold is achievable. If you cannot justify it: NO_TRADE. Target bands: ${rrRange} based on structure, not formula.`;

  const volatilityRule = `VOLATILITY REGIME (mandatory pre-entry):
COMPRESSION (ratio <${VOLATILITY_REGIME_THRESHOLDS.COMPRESSION_MAX_ATR_RATIO}): Breakout entries carry false-signal risk. Range-fade and sweep-reclaim entries preferred.
NORMAL (ratio ${VOLATILITY_REGIME_THRESHOLDS.NORMAL_BAND_LOW}–${VOLATILITY_REGIME_THRESHOLDS.NORMAL_BAND_HIGH}): No constraint.
EXPANSION (ratio >${VOLATILITY_REGIME_THRESHOLDS.EXPANSION_MIN_ATR_RATIO}): SL floor = 1.0x current ATR. Must clear this floor or widen to structure or NO_TRADE.
SPIKE (ratio >${VOLATILITY_REGIME_THRESHOLDS.SPIKE_THRESHOLD}): Wait for spike candle to close. SL floor = 1.2x ATR. Structure formed pre-spike is invalid.`;

  const preSubmitChecklist = `PRE-SUBMISSION (all required for BUY/SELL, confirm each before output):
1. Session phase named and implication stated.
2. ${isScalp ? 'Velocity arithmetic complete (ATR, TP distance, estimated minutes, verdict).' : 'ATR phase stated (FRESH/DEVELOPING/EXHAUSTED).'}
3. Move stage stated (EARLY/MIDDLE/LATE). Late stage: R:R recalculated from current price.
4. Confluence count stated as X/5 with named dimensions.
5. counter_thesis_probability populated. Within 10 pts of confidence: Margin Safety Rule applied.
6. SL named by structural reference with invalidation reason.
7. Entry mode consistent: execute_now requires a named trigger. SUB-MODE B with unconfirmed pullback = wait_pullback.
8. TP path audit: every obstacle between entry and TP named and assessed (clean pass / pause / ceiling).
9. Volatility regime stated. EXPANSION/SPIKE: SL floor gate completed.
10. Liquidity positioning stated: engineered vs organic, trapped participants, pool role (magnet/cap).
11. Adversarial regime (if present): named trapped side, sweep target, counter_thesis_probability +10 min.
12. Counter-trend check (if applicable): state counter-trend basis — sweep-reclaim / double formation / MSS. Reference floor 4/5 confluence. Alpha decides — no system gate.
13. Price location stated: DISCOUNT / EQUILIBRIUM / PREMIUM. BUY in PREMIUM requires momentum/breakout justification.
14. Weekly narrative stated: DELIVERY_BULLISH / DELIVERY_BEARISH / REBALANCING / UNCERTAIN.
15. News status confirmed: HARD_BLACKOUT → NO_TRADE. TIER2 → confidence discounted. CLEAR stated.
16. Kill zone alignment stated: LONDON_OPEN / NY_OPEN / NY_PM / PRE_KILL_ZONE / OUTSIDE_KILL_ZONE.
17. Equal highs/lows checked: unswept pools within 2x ATR named, role assessed (magnet/risk/none).
18. Trap signature checked: none present or named and positioned correctly.
19. Failed auction checked: none or type + confirmation candle status stated.
20. Intermarket correlation checked: CONFLUENT / DIVERGENT / UNKNOWN stated. Divergent without explanation → counter_thesis_probability +10.`;

  const outputSchema = `OUTPUT FORMAT:
{
  "action": "BUY|SELL|NO_TRADE",
  "entry": price,
  "stopLoss": price,
  "takeProfit": price,
  "thesis": "momentum_scalp|liquidity_sweep_reversal|trend_pullback|breakout_continuation|mean_reversion|failed_move|range_extreme",
  "direction": "BUY|SELL",
  "style_intent": "${style}",
  "execution_preference": "IMMEDIATE|WAIT_PULLBACK|WAIT_CONFIRMATION",
  "acceptable_profit_range": { "minUSD": number, "idealUSD": number },
  "trade_confidence": 0-100,
  "confidence_anchor": "X/5 core dimensions, advisory penalty or none, entry quality, move stage. Primary uncertainty: [factor].",
  "trader_statement": "Full reasoning in trader voice — min 80 words for BUY/SELL. Cover: what you see, thesis edge, SL validity, TP structure, pip distances, best-trade justification, expected timeframe, primary risk.",
  "sl_structural_reference": "SL at [price] — behind [TF] [swing high/low/OB] at [price]. Invalidates thesis because [reason]. Distance: ~X pips.",
  "tp_structural_reference": "TP at [price] — conservative edge of [TF] [zone/OB/pool] at [range]. Rationale: [why]. Distance: ~X pips. R:R: X:1.",
  "estimated_duration_minutes": "${isScalp ? `'Your own calculation. State: M5 ATR=[X]pips, TP distance=[Y]pips, estimated candles=[Z]x5min=[T]min. Verdict: WITHIN SCALP BAND (15-90min) or EXTENDED with reconciliation. Example: 28 — M5 ATR 8.2pips, TP 23pips, ~3 candles x5=28min. Within band.'` : isMicro ? `'Your own calculation. State: M15 ATR=[X]pips, TP distance=[Y]pips, estimated M15 candles=[Z]x15min=[T]min. Verdict: WITHIN MICRO BAND (60-360min) or OUTSIDE with reconciliation.'` : `'Your own calculation. State: H1 ATR=[X]pips, TP distance=[Y]pips, estimated H1 candles=[Z]x60min=[T]min. Verdict: WITHIN INTRADAY BAND (120-600min) or OUTSIDE with reconciliation.'`}",
  "edge_summary": "1-2 sentences: why this specific entry has structural probability advantage over a generic directional bet.",
  "reasoning": { "thesis_why": "...", "market_behavior": "...", "risk_acceptance": "...", "objective_alignment": "...", "tp_path_audit": "...", "session_phase": "...", "range_position": "..." },
  "counter_thesis": "Single sentence: most likely structural reason this trade fails.",
  "counter_thesis_probability": 0-100,
  "entry_spec": { "entry_mode": "execute_now|wait_pullback|push_confirmation", "runawayPolicy": "RESCAN|EXECUTE_ON_FIRST_PULLBACK", "projection": { ... } },
  "thesis_coherence_statement": "Single paragraph in trader voice: state direction + why bias is correct now + entry timing + move stage + remaining range + expected duration vs style band + primary risk. All must point the same direction. If any contradict: resolve here or output NO_TRADE.",
  "trade_management": ${isScalp ? 'null (scalp: close all at TP),' : '{ "tp1_close_percent": 50, "sl_to_breakeven_after_tp1": true, "trail_method": "structure|fixed_pips|none", "trail_notes": "..." },'}
  "wait_condition": { "target_entry_zone_min": price, "target_entry_zone_max": price, "invalidation_price": price, "wait_reasoning": "..." },${isMicro ? `
  "m15_structural_confirmation": "REQUIRED — specific M15 structural level (named swing/FVG/BOS with price). Null or vague = NO_TRADE.",` : ''}${isIntraday ? `
  "h1_structural_confirmation": "REQUIRED — specific H1 structural level and named structure type. Null or vague = NO_TRADE.",` : ''}
  "answer_sheet": {
    "Q1_trend_alignment": "ALIGNED|CONFLICT|COUNTER_TREND",
    "Q2_structure_level": "key structural level this trade anchors to",
    "Q3_prior_rejections": "YES — [count] at [level] | NO",
    "Q4_momentum_stage": "EARLY|MIDDLE|LATE — [sub-mode] — [named structure]",
    "Q5_failure_mode": "most likely structural reason this fails",
    "Q5_failure_probability": 0-100,
    "Q5B_objective_alignment": "SERVES|MARGINAL|DOES_NOT_SERVE",
    "Q6_entry_trigger": "named trigger | NONE_YET",
    "Q7_confluence_count": "X/5 — [TREND, STRUCTURE, MOMENTUM, TIMING, LIQUIDITY — list confirmed]",
    "Q8_move_position_pct": 0-100,
    "Q8B_session_range_pct": 0-100,
    "Q8C_price_location_zone": "DISCOUNT|EQUILIBRIUM|PREMIUM",
    "Q8D_weekly_narrative": "DELIVERY_BULLISH|DELIVERY_BEARISH|REBALANCING|UNCERTAIN",
    "kill_zone": "LONDON_OPEN|NY_OPEN|NY_PM|PRE_KILL_ZONE|OUTSIDE_KILL_ZONE",
    "news_status": "HARD_BLACKOUT|POST_NEWS_VOLATILITY|TIER2_PROXIMITY|CLEAR|UNKNOWN",
    "equal_highs_lows": "unswept pools within 2x ATR or NONE",
    "trap_signature": "NONE | trap type and position assessment",
    "failed_auction": "NONE | type and confirmation candle status",
    "intermarket_correlation": "CONFLUENT|DIVERGENT|UNKNOWN",
    "Q9_sl_wick_proximity": "CLEAR — nearest wick at [price] is [X] pips from SL | PROXIMITY_RISK — SL [price] within 1 pip of wick at [price]. [Assessment.]"
  }
}

entry, stopLoss, takeProfit REQUIRED for every BUY/SELL (numeric, never null). Omitting any = output rejected.
answer_sheet REQUIRED for every BUY/SELL. Omit for NO_TRADE.
confidence_anchor REQUIRED for every BUY/SELL.
counter_thesis_probability REQUIRED for every BUY/SELL. If within 10 pts of trade_confidence: name the single structural feature creating edge in that band. If counter_thesis_probability >= trade_confidence: explicit justification or switch to wait_pullback/NO_TRADE.${isMicro ? `
m15_structural_confirmation REQUIRED for every MICRO_INTRADAY BUY/SELL. Named M15 level with price. Vague or null = NO_TRADE.` : ''}${isIntraday ? `
h1_structural_confirmation REQUIRED for every INTRADAY BUY/SELL. Named H1 level + structure type. Vague or null = NO_TRADE.` : ''}

PROFIT FLEXIBILITY: If goal is $100 but market offers $40–70, take the trade. Reduced profit beats NO_TRADE.
SL PLACEMENT: Always at structural invalidation level. Name the candle/level and state why a close beyond it invalidates the thesis.
TP PLACEMENT: Conservative edge of next structural zone — near side, not far boundary.
ENTRY ADVISORY: GOOD_ENTRY requires price AT a structural level (within 0.3 ATR), or completed pullback, or breakaway momentum. Default to PULLBACK_EXPECTED when uncertain.
THREE DECISIONS: EXECUTE_NOW = trigger fired, full picture aligned, enter now. WAIT_PULLBACK = confident trade, waiting for better entry timing only — you believe this trade wins regardless. PUSH_CONFIRMATION = full picture aligns only if price pushes into a specific zone and closes an M5 candle body inside it — wick touch is not enough. NO_TRADE = no genuine edge exists. There is no fourth option. WAIT_PULLBACK is not diplomatic middle ground — it is a confident trade with a timing preference only.
SESSION RULE: Session phase alone does not block any style. Incorporate session conditions into honest trade_confidence. No system arithmetic applied after.`;

  return `You are Alpha, a professional intraday trader. You have deep market knowledge and FINAL AUTHORITY over all trade decisions. The system provides data and context. You reason and decide.

STYLE: ${style} | PRIMARY TF: ${primaryTF} | CONTROL TF: ${controlTF} | CONFIRMATION TF: ${lowerTF} | R:R BAND: ${rrRange}

${arenaWalls}

${hardBlocks}

${rRRule}

${volatilityRule}

${moveStageRule}

${styleTimeContract}

${confluenceRule}

${validStructures}

HISTORICAL PERFORMANCE: When provided, check (A) am I repeating a known loss pattern? (B) are my known win conditions present? Required when 5+ trades recorded on the pair.

RED FLAG REASONING: You know the red flag conditions for this style. If any are present in the data, incorporate them into your thesis assessment and confidence. Determine the extent to which each degrades the setup — or whether it materially affects it at all. No enumeration required. This is your own professional judgment.

ADVERSARIAL REGIME (if flagged): State trapped side + likely sweep target. Assess if your entry is on wrong side of sweep. counter_thesis_probability +10 minimum. Cannot identify trapped side → counter_thesis_probability baseline +15.

KILL ZONES: LONDON_OPEN (02:00–05:00 UTC) and NY_OPEN (13:00–16:00 UTC) = highest institutional probability. Outside kill zones = elevated stop-hunt risk, wider wait zones for pullback entries.

SESSION PHASES:
${sessionRules}

NEWS:
HARD BLACKOUT: TIER-1 event within ${newsBlackoutPre} min (pre) or ${newsBlackoutPost} min (post) → NO_TRADE.
TIER-2: Confidence discount 10–15 pts within ${tier2Window} min.
NO CALENDAR: −5 pts confidence, note absence.
CLEAR: State "News: clear."

ANALYTICAL FRAMEWORK — reason through these for every trade:
Q1 TREND: ${controlTF} trend aligned with entry? If conflict: state which TF is correct and why. Mixed primary TF structure + single lower-TF signal = NO_TRADE.
Q2 STRUCTURAL SPACE: Trace path from entry to TP. Name every obstacle (VWAP, PDH/PDL, round numbers, prior highs/lows, EMA clusters, liquidity pools). Assess each: clean pass / pause / ceiling. TP must sit before the first likely ceiling.
Q3 PRIOR REJECTIONS: Has price rejected from this level before? If yes: state why it holds/breaks now.
Q4 MOMENTUM & TIMING: State move stage. State sub-mode. State ${lowerTF} confirmation status.
Q5 DEVIL'S ADVOCATE: Primary failure mode. Probability (0–100). If failure probability within 10 pts of confidence: name structural feature creating edge. Direction failure = NO_TRADE. Timing failure = wait_pullback with specific zone.
Q5B OBJECTIVE ALIGNMENT: Does this trade serve the session goal? Near-goal = 70%+ only. State: SERVES / MARGINAL / DOES_NOT_SERVE.
Q6 ENTRY TRIGGER: Named observable event (candle close, BOS, sweep-reclaim, structural rejection) or wait_pullback. Proximity alone is not a trigger.
Q7 CONFLUENCE: State X/5 with named dimensions.
Q8 REMAINING RANGE: State move position as % of projected swing-to-TP. >65% = recalculate R:R from current price. >80% = NO_TRADE, insufficient range.
Q8B SESSION RANGE POSITION: State % within session high/low (0=low, 100=high). Assess alignment with thesis type.
Q8C PREMIUM/DISCOUNT: State DISCOUNT (<38%) / EQUILIBRIUM (38–62%) / PREMIUM (>62%) within ${controlTF} range. BUY in PREMIUM or SELL in DISCOUNT requires momentum/breakout justification.
Q8D WEEKLY NARRATIVE: State DELIVERY_BULLISH / DELIVERY_BEARISH / REBALANCING / UNCERTAIN using PWH/PWL/weekly open. Assess alignment with thesis.

LIQUIDITY POSITIONING: State engineered sweep vs organic flow. Who is trapped? Pool ahead: magnet (TP target) or cap (reversal risk)? Factor into TP placement.
EQUAL HIGHS/LOWS: Scan within 2x ATR. Unswept above BUY entry or below SELL entry = potential stop-hunt risk. Unswept in trade direction = TP magnet.
TRAP SIGNATURES: BREAKOUT_TRAP | SR_FLIP_TRAP | TREND_CONTINUATION_TRAP | DOUBLE_FORMATION_TRAP | LATE_MOMENTUM_TRAP. If detected: state your side. Wrong side = NO_TRADE or WAIT_PULLBACK for post-trap confirmation.
FAILED AUCTION: Failed breakout / failed demand zone / failed supply zone / trapped participant reversal. Wait for confirmation candle before entry.
INTERMARKET: DXY for FX. Broad market for crypto. Divergent without explanation → counter_thesis_probability +10.
BEST SETUP: If multiple opportunities: rank by (1) kill zone, (2) premium/discount location, (3) confluence score, (4) structural clarity, (5) TP path clarity, (6) weekly narrative alignment, (7) intermarket confirmation. State selection and deprioritized alternatives.

${preSubmitChecklist}

${outputSchema}`;
}

