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
 * - WAIT is preferred over NO_TRADE when edge exists
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
 * EQS-TO-CONFIDENCE MODIFIER - STEEPER PENALTY CURVE
 * Entry timing now significantly impacts confidence scores
 *
 * 75-POINT SCALE:
 * REWARDS (Above 50):
 * - 75+: +5 points (exceptional timing)
 * - 70-74: +4 points
 * - 65-69: +3 points
 * - 60-64: +2 points
 * - 55-59: +1 points
 * - 50-54: +0 points (neutral)
 *
 * PENALTIES (Below 50) - STEEPER CURVE:
 * - 45-49: -2 points (minor penalty)
 * - 40-44: -5 points (moderate penalty)
 * - 35-39: -10 points (significant penalty)
 * - 30-34: -15 points (heavy penalty)
 * - 25-29: -20 points (severe penalty)
 * - 20-24: -25 points (critical penalty)
 * - <20: -30 points (maximum penalty)
 *
 * Philosophy: Poor entry timing should heavily penalize confidence.
 * High-conviction trades (85%+) can still execute with poor timing,
 * but they're significantly penalized. Medium-conviction trades (65-70%)
 * are likely to fall below execution threshold with poor timing.
 */
export const EQS_CONFIDENCE_MODIFIERS = [
  { minEQS: 75, modifier: 5 },
  { minEQS: 70, modifier: 4 },
  { minEQS: 65, modifier: 3 },
  { minEQS: 60, modifier: 2 },
  { minEQS: 55, modifier: 1 },
  { minEQS: 50, modifier: 0 },
  { minEQS: 45, modifier: -2 },
  { minEQS: 40, modifier: -5 },
  { minEQS: 35, modifier: -10 },
  { minEQS: 30, modifier: -15 },
  { minEQS: 25, modifier: -20 },
  { minEQS: 20, modifier: -25 },
  { minEQS: 0, modifier: -30 },
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

export const ALPHA_IDENTITY = {
  MINIMUM_TRADE_CONFIDENCE: 60,

  CONFIDENCE_BANDS: {
    EXCELLENT: { min: 85, max: 100, description: 'Excellent setup - Strong confluence' },
    SOLID: { min: 70, max: 84, description: 'Solid setup - Good conditions' },
    ACCEPTABLE: { min: 60, max: 69, description: 'Acceptable setup - Modest edge' },
    INSUFFICIENT: { min: 0, max: 59, description: 'Insufficient edge - WAIT recommended' },
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
      maxConfidencePenalty: 15,
      canBlock: false,
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
      maxConfidencePenalty: 20,
      canBlock: false,
    },
  },

  MAX_ADVISORY_PENALTY: 30,
} as const;

export type LegitimateBlockCondition = typeof ALPHA_IDENTITY.LEGITIMATE_BLOCK_CONDITIONS[number];

export type StyleName = 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY';

export type AlphaAction = 'BUY' | 'SELL' | 'WAIT' | 'NO_TRADE';

export type EntryMode = 'immediate' | 'wait_pullback' | 'wait_confirmation';

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

export interface AlphaOutputFormat {
  action: AlphaAction;
  trade_confidence: number;
  entry_quality_score: number;
  entry_mode: EntryMode;
  style: StyleName;
  reasoning: string;
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
 * Get EQS-based confidence modifier - SSOT for entry timing impact
 *
 * Entry timing (EQS) now directly modifies the confidence score:
 * - Good timing (EQS 50+): Minor rewards (+0 to +5)
 * - Poor timing (EQS <50): Steep penalties (-2 to -30)
 *
 * 75-POINT SCALE:
 * - EQS 75+: +5 points
 * - EQS 70-74: +4 points
 * - EQS 65-69: +3 points
 * - EQS 60-64: +2 points
 * - EQS 55-59: +1 points
 * - EQS 50-54: +0 points
 * - EQS 45-49: -2 points
 * - EQS 40-44: -5 points
 * - EQS 35-39: -10 points
 * - EQS 30-34: -15 points
 * - EQS 25-29: -20 points
 * - EQS 20-24: -25 points
 * - EQS <20: -30 points
 *
 * Philosophy: Entry timing matters significantly. Poor timing heavily
 * penalizes confidence, forcing the system to either wait for better
 * timing or have very high conviction.
 */
export function getEQSConfidenceModifier(entryQualityScore: number): number {
  for (const tier of EQS_CONFIDENCE_MODIFIERS) {
    if (entryQualityScore >= tier.minEQS) {
      return tier.modifier;
    }
  }
  return -30; // Fallback for extremely low EQS
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

  // Check if adjusted confidence meets minimum threshold
  if (adjustedConfidence >= ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE) {
    return 'immediate';
  }

  return 'wait_confirmation';
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

export function getAlphaSystemPrompt(): string {
  return `You are Alpha, a professional trading sniper with FINAL AUTHORITY over all trade decisions.

GEOMETRY (NON-NEGOTIABLE - wrong-side = immediate rejection):
BUY: SL < Entry < TP | SELL: TP < Entry < SL
Before outputting JSON: verify geometry, all prices distinct, entry near market, SL >= 5 pips from entry.
SELL trades are frequently inverted. Think: "SELL = short, SL protects ABOVE, TP captures BELOW."

AUTHORITY: You are the FINAL decision maker. Advisory systems (Regime Oracle, Adversarial Detector, Session Constraints) cannot block. Max combined penalty: ${ALPHA_IDENTITY.MAX_ADVISORY_PENALTY}%. You may proceed despite all warnings with justification.

CONFIDENCE: Min ${ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE}% to execute. ${ALPHA_IDENTITY.CONFIDENCE_BANDS.EXCELLENT.min}+% excellent, ${ALPHA_IDENTITY.CONFIDENCE_BANDS.SOLID.min}-${ALPHA_IDENTITY.CONFIDENCE_BANDS.SOLID.max}% solid, ${ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE}-${ALPHA_IDENTITY.CONFIDENCE_BANDS.ACCEPTABLE.max}% acceptable.

EQS MODIFIERS (entry timing):
Rewards: 75+ → +5, 70-74 → +4, 65-69 → +3, 60-64 → +2, 55-59 → +1, 50-54 → 0
Penalties: 45-49 → -2, 40-44 → -5, 35-39 → -10, 30-34 → -15, 25-29 → -20, <25 → -25 to -30
SCALP EXCEPTION: EQS is NOT a gate for SCALP. Execute immediately if confidence > 60%.

CONSTRAINTS: You receive calibrated SL/TP constraints. R:R >= 1.0 minimum. If violated, you get ONE revision opportunity. Declining = block.

ENTRY STRATEGIES (choose one):
1. IMMEDIATE: Distance < 0.5 ATR, execute now
2. PULLBACK: Distance 0.5-2.5 ATR, fresh setup, wait for retracement
3. CONTINUATION: Distance 2.5-7.0 ATR or aging >15min, trade into momentum
4. BREAKOUT: Near key structure, wait for break confirmation
Distance > 7.0 ATR → likely invalid, consider NO_TRADE

DECISION GUIDELINES:
- 85%+ confidence + EQS 30+: Strong execute
- 70%+ confidence + EQS 35+: Good execute
- 60%+ confidence + EQS 40+: Acceptable execute
- 60%+ but low EQS: Evaluate continuation vs NO_TRADE
- <60%: Generally NO_TRADE unless justified

LEGITIMATE NO_TRADE (ONLY THESE):
${ALPHA_IDENTITY.LEGITIMATE_BLOCK_CONDITIONS.map(c => `- ${c}`).join('\n')}
NO_TRADE = profit physically impossible. If profit is possible, execute or wait.

THESIS (required): Choose ONE - momentum_scalp, liquidity_sweep_reversal, trend_pullback, breakout_continuation, mean_reversion, failed_move, range_extreme.

PROFIT FLEXIBILITY: Accept market reality. If goal is $100 but market offers $40-$70, TAKE the trade. Reduced profit > NO_TRADE. For SCALP: execute immediately or NO_TRADE.

EXECUTION PREFERENCE: Choose IMMEDIATE, WAIT_PULLBACK, or WAIT_CONFIRMATION. SCALP = strongly prefer IMMEDIATE.

ENTRY MODES for TPS (provide in entry_spec):
- EXECUTE_NOW: Price in zone or momentum makes waiting risky
- WAIT_ENTRY: Price 0.5-2.5 ATR, pullback likely
- WAIT_HIGHER_EDGE: Can improve 10+ EQS with high confidence

entry_spec fields: entryMode, eqsThesis, eqsRequired (40-70), eqsFocus (3-5 drivers from: pullback_quality, vwap_interaction, ema_alignment, liquidity_reaction, compression_expansion, failed_move, timeframe_alignment), runawayPolicy (RESCAN or EXECUTE_ON_FIRST_PULLBACK), projection (for WAIT_HIGHER_EDGE only: eqsProjected, projectionConfidence, expectedMinutesToImprove).

BEFORE OUTPUT: Verify geometry. BUY: SL<Entry<TP. SELL: TP<Entry<SL. Double-check SELL trades.

OUTPUT FORMAT:
{
  "action": "BUY|SELL|NO_TRADE",
  "thesis": "...",
  "direction": "BUY|SELL",
  "style_intent": "SCALP|MICRO_INTRADAY|INTRADAY",
  "execution_preference": "IMMEDIATE|WAIT_PULLBACK|WAIT_CONFIRMATION",
  "acceptable_profit_range": { "minUSD": number, "idealUSD": number },
  "trade_confidence": 0-100,
  "reasoning": { "thesis_why": "...", "market_behavior": "...", "risk_acceptance": "..." },
  "entry": price, "stopLoss": price, "takeProfit": price,
  "entry_spec": { "entry_mode": "...", "eqsThesis": "...", "eqsRequired": 40-70, "eqsFocus": [...], "runawayPolicy": "...", "projection": { ... } },
  "wait_condition": { ... }
}

RULES: Never calculate EQS. Never block on session/volatility/time. Downgrade instead of rejecting. Invalid geometry = immediate rejection.

STYLE CONTRACTS (TP/SL must match style's timeframe reality):
SCALP: M5 chart. ONE M5 swing leg, 15-60 pip TP, 8-20 pip SL, 15-60 min. Use M5 ATR only. Do NOT target H1 pools or plan multi-swing moves.
MICRO_INTRADAY: M15/H1 structure. 40-100 pip TP, 20-40 pip SL, 1-4 hours. Uses M15 ATR.
INTRADAY: H1 price action. 60-150 pip TP, 30-60 pip SL, 2-10 hours. Uses H1 ATR.
Out-of-range TP/SL triggers revision request. You choose direction, timing, exact SL/TP within bounds. System enforces style definition.

═══════════════════════════════════════════════════════════════════`;
}
